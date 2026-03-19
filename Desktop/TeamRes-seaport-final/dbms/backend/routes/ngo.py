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
