import json, os
from flask import Blueprint, request
from database import get_db, api_response, api_error

ngo_bp = Blueprint('ngo', __name__)

NGOS_JSON = os.path.join(os.path.dirname(__file__), '..', 'ngos.json')

def _load_ngos():
    with open(NGOS_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


@ngo_bp.route('/list-by-force', methods=['GET'])
def list_by_force():
    force = request.args.get('force', '').strip()
    all_ngos = _load_ngos()
    ngos = all_ngos.get(force, [])
    return api_response(data=ngos)




@ngo_bp.route('/assignments', methods=['GET'])
def get_assignments():
    status = request.args.get('status', '')
    limit  = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    cond   = "WHERE 1=1"
    params = []
    if status:
        cond += " AND na.status=?"
        params.append(status)

    db = get_db()
    try:
        rows = db.execute(f"""
            SELECT na.id, na.ngo_name, na.message, na.status,
                   na.created_at, na.acknowledged_at,
                   rr.provisional_id, rr.force, rr.entry_point,
                   e.name, e.nationality, e.assigned_camp,
                   e.medical_needs, e.help_tags, e.dob, e.gender
            FROM ngo_assignments na
            JOIN refugee_registrations rr ON rr.id = na.refugee_registration_id
            JOIN entities e ON e.id = rr.entity_id
            {cond}
            ORDER BY na.created_at DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()

        total = db.execute(f"""
            SELECT COUNT(*) as c FROM ngo_assignments na {cond}
        """, params).fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'items': [dict(r) for r in rows],
        'total': total
    })


@ngo_bp.route('/assignments/<assignment_id>/status', methods=['PATCH'])
def update_status(assignment_id):
    data       = request.get_json(silent=True) or {}
    new_status = data.get('status', '').strip()
    valid      = ('Pending', 'Acknowledged', 'In Progress', 'Completed')
    if new_status not in valid:
        return api_error(f'status must be one of: {", ".join(valid)}')

    db = get_db()
    try:
        ack = "datetime('now')" if new_status == 'Acknowledged' else 'NULL'
        db.execute(f"""
            UPDATE ngo_assignments
            SET status=?, acknowledged_at={ack}
            WHERE id=?
        """, (new_status, assignment_id))
        db.commit()
        if db.execute("SELECT changes() as n").fetchone()['n'] == 0:
            db.close()
            return api_error('Assignment not found', 404)
    except Exception as e:
        db.close()
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(message=f'Status updated to {new_status}')


@ngo_bp.route('/assignments/counts', methods=['GET'])
def assignment_counts():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT status, COUNT(*) as count FROM ngo_assignments GROUP BY status"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])

@ngo_bp.route('/<int:ngo_id>/capacity', methods=['PUT'])
def update_ngo_capacity(ngo_id):
    data = request.get_json(silent=True) or {}
    max_cap = int(data.get('max_capacity', 0))
    db = get_db()
    try:
        db.execute("UPDATE ngos SET max_capacity=? WHERE id=?", (max_cap, ngo_id))
        
        # Check occupancy
        ngo = db.execute("SELECT name, max_capacity FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        if ngo and ngo['max_capacity'] > 0:
            count = db.execute("SELECT COUNT(*) as c FROM refugee_registrations WHERE assigned_ngo=?", (ngo['name'],)).fetchone()['c']
            pct = (count / ngo['max_capacity']) * 100
            if pct >= 90:
                # Write critical alert
                db.execute("INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                           ('ngo', f"NGO {ngo['name']} is at {pct:.1f}% capacity.", 'critical', 'Capacity Monitor'))
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message="Capacity updated")

@ngo_bp.route('/<ngo_id>/appeals', methods=['GET'])
def get_ngo_appeals(ngo_id):
    db = get_db()
    try:
        # Join to get assignment info
        rows = db.execute("""
            SELECT a.id, a.provisional_id, a.type, a.description, a.status, a.timestamp, e.name as refugee_name
            FROM appeals a
            JOIN refugee_registrations rr ON a.provisional_id = rr.provisional_id
            JOIN entities e ON rr.entity_id = e.id
            WHERE a.status = 'open' OR a.status = 'in_progress'
            ORDER BY a.timestamp ASC
        """).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()

@ngo_bp.route('/appeals/<int:appeal_id>', methods=['PUT'])
def update_appeal(appeal_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status', 'open')
    notes = data.get('response_notes', '')
    
    db = get_db()
    try:
        db.execute(
            "UPDATE appeals SET status=?, response_notes=? WHERE id=?",
            (status, notes, appeal_id)
        )
        db.commit()
        return api_response(message='Appeal updated successfully')
    finally:
        db.close()


# ── Prompt 10: Standalone NGO Portal Endpoints ────────────────

@ngo_bp.route('/<int:ngo_id>/refugees', methods=['GET'])
def get_ngo_refugees(ngo_id):
    db = get_db()
    try:
        ngo = db.execute("SELECT name FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        if not ngo:
            return api_error('NGO not found', 404)
        rows = db.execute("""
            SELECT rr.id as reg_id, rr.provisional_id, rr.status as reg_status,
                   e.name, e.status, e.medical_needs, e.help_tags, e.gender, e.dob,
                   (SELECT MAX(date) FROM aid_distribution ad WHERE ad.refugee_id = rr.provisional_id) as last_aid_date
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            WHERE rr.assigned_ngo = ?
        """, (ngo['name'],)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/workers', methods=['GET'])
def get_ngo_workers(ngo_id):
    db = get_db()
    try:
        rows = db.execute("SELECT id, name, email, role FROM users WHERE ngo_id=? AND role='ngo_worker'", (ngo_id,)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/workers', methods=['POST'])
def create_ngo_worker(ngo_id):
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    if not name or not email or not password:
        return api_error("Name, email and password are required")
    db = get_db()
    try:
        db.execute("INSERT INTO users (name, email, password, role, ngo_id) VALUES (?, ?, ?, 'ngo_worker', ?)",
                   (name, email, password, ngo_id))
        db.commit()
        return api_response(message="Worker created")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()


@ngo_bp.route('/workers/<int:worker_id>', methods=['DELETE'])
def delete_ngo_worker(worker_id):
    db = get_db()
    try:
        db.execute("DELETE FROM users WHERE id=?", (worker_id,))
        db.commit()
        return api_response(message="Worker deactivated/deleted")
    finally:
        db.close()


@ngo_bp.route('/resource-request', methods=['POST'])
def create_resource_request():
    data = request.get_json(silent=True) or {}
    ngo_id = data.get('ngo_id')
    req_type = data.get('request_type', '').strip()
    desc = data.get('description', '').strip()
    if not ngo_id or not req_type:
        return api_error("ngo_id and request_type required")
    db = get_db()
    try:
        db.execute("INSERT INTO resource_requests (ngo_id, request_type, description) VALUES (?, ?, ?)",
                   (ngo_id, req_type, desc))
        ngo = db.execute("SELECT name FROM ngos WHERE id=?", (ngo_id,)).fetchone()
        ngo_name = ngo['name'] if ngo else 'Unknown NGO'
        db.execute("INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                   ('ngo', f"Resource request from NGO {ngo_name}: {desc}", 'warning', 'NGO Portal'))
        db.commit()
        return api_response(message="Resource request submitted")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()


@ngo_bp.route('/<int:ngo_id>/resource-requests', methods=['GET'])
def get_resource_requests(ngo_id):
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM resource_requests WHERE ngo_id=? ORDER BY timestamp DESC", (ngo_id,)).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@ngo_bp.route('/aid-log', methods=['POST'])
def log_aid():
    data = request.get_json(silent=True) or {}
    refugee_id = data.get('refugee_id')
    worker_id = data.get('worker_id')
    ngo_id = data.get('ngo_id')
    aid_type = data.get('aid_type')
    desc = data.get('description')
    date_str = data.get('date')
    if not all([refugee_id, worker_id, ngo_id, aid_type, date_str]):
        return api_error("Missing required fields")
    db = get_db()
    try:
        db.execute("INSERT INTO aid_distribution (refugee_id, worker_id, ngo_id, aid_type, description, date) VALUES (?, ?, ?, ?, ?, ?)",
                   (refugee_id, worker_id, ngo_id, aid_type, desc, date_str))
        worker = db.execute("SELECT name FROM users WHERE id=?", (worker_id,)).fetchone()
        worker_name = worker['name'] if worker else 'Worker'
        db.execute("INSERT INTO refugee_status_log (provisional_id, stage, updated_by) VALUES (?, 'aid_received', ?)",
                   (refugee_id, worker_name))
        db.commit()
        return api_response(message="Aid logged successfully")
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
