import json, os
from flask import Blueprint, request
from database import get_db, rows_to_list, api_response, api_error

dashboard_bp = Blueprint('dashboard', __name__)


@dashboard_bp.route('/kpis', methods=['GET'])
def get_kpis():
    db = get_db()
    try:
        volume   = db.execute("SELECT COUNT(*) as c FROM entities").fetchone()['c']
        flags    = db.execute("SELECT COUNT(*) as c FROM entities WHERE is_blacklist=1 OR status='Flagged'").fetchone()['c']
        no_ngo   = db.execute("SELECT COUNT(*) as c FROM entities WHERE type IN ('Refugee','Migrant') AND (assigned_ngo IS NULL OR assigned_ngo='')").fetchone()['c']
        incidents = db.execute("SELECT COUNT(*) as c FROM incidents WHERE status='Open'").fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'volume':    volume,
        'flags':     flags,
        'pending_aid': no_ngo,
        'incidents': incidents
    })


@dashboard_bp.route('/marker-stats', methods=['GET'])
def marker_stats():
    location = request.args.get('location', '')
    if not location:
        return api_error('location parameter required')

    db = get_db()
    try:
        total = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ?",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
        flagged = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ? AND (is_blacklist=1 OR status='Flagged')",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
        aid = db.execute(
            "SELECT COUNT(*) as c FROM entities WHERE entry_point LIKE ? AND type IN ('Refugee','Migrant') AND (assigned_ngo IS NULL OR assigned_ngo='')",
            (f'%{location[:20]}%',)
        ).fetchone()['c']
    finally:
        db.close()

    return api_response(data={
        'location': location,
        'total':    total,
        'flagged':  flagged,
        'pending_aid': aid
    })


@dashboard_bp.route('/entity-types', methods=['GET'])
def entity_types():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT type, COUNT(*) as count FROM entities GROUP BY type"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])


@dashboard_bp.route('/top-entry-points', methods=['GET'])
def top_entry_points():
    db = get_db()
    try:
        rows = db.execute(
            "SELECT entry_point, COUNT(*) as count FROM entities WHERE entry_point IS NOT NULL GROUP BY entry_point ORDER BY count DESC LIMIT 8"
        ).fetchall()
    finally:
        db.close()
    return api_response(data=[dict(r) for r in rows])


NGOS_JSON = os.path.join(os.path.dirname(__file__), '..', 'ngos.json')


def _load_all_ngos():
    """Return a flat list of unique NGO names from ngos.json."""
    with open(NGOS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)
    seen = set()
    ngos = []
    for force_ngos in data.values():
        for ngo in force_ngos:
            name = ngo.get('name', '')
            if name and name not in seen:
                seen.add(name)
                ngos.append(ngo)
    return ngos


@dashboard_bp.route('/refugees', methods=['GET'])
def list_all_refugees():
    """List all registered refugees for the dashboard tab."""
    limit  = min(int(request.args.get('limit', 100)), 500)
    offset = int(request.args.get('offset', 0))
    db = get_db()
    try:
        rows = db.execute("""
            SELECT rr.id AS reg_id, rr.provisional_id, rr.force, rr.registration_date,
                   rr.assigned_ngo, rr.status AS reg_status, rr.entry_point,
                   e.name, e.nationality, e.assigned_camp, e.status AS entity_status
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            ORDER BY rr.registration_date DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
        total = db.execute("SELECT COUNT(*) as c FROM refugee_registrations").fetchone()['c']
    finally:
        db.close()
    return api_response(data={'items': [dict(r) for r in rows], 'total': total})


@dashboard_bp.route('/ngo-list', methods=['GET'])
def ngo_list():
    """Return the flat list of all NGOs."""
    return api_response(data=_load_all_ngos())


@dashboard_bp.route('/ngo-assignments/<reg_id>', methods=['PATCH'])
def update_ngo_assignment(reg_id):
    """Reassign a refugee to a different NGO."""
    data     = request.get_json(silent=True) or {}
    ngo_name = data.get('ngo_name', '').strip()
    ngo_id   = data.get('ngo_id', '').strip() or 'NGO-AUTO'
    if not ngo_name:
        return api_error('ngo_name is required')

    db = get_db()
    try:
        # Update refugee_registrations
        db.execute(
            "UPDATE refugee_registrations SET assigned_ngo=? WHERE id=?",
            (ngo_name, reg_id)
        )
        # Update entity.assigned_ngo for the matching entity
        db.execute("""
            UPDATE entities SET assigned_ngo=?, updated_at=datetime('now')
            WHERE id IN (SELECT entity_id FROM refugee_registrations WHERE id=?)
        """, (ngo_name, reg_id))
        # Update the ngo_assignments row
        db.execute("""
            UPDATE ngo_assignments SET ngo_name=?, ngo_id=?
            WHERE refugee_registration_id=?
        """, (ngo_name, ngo_id, reg_id))
        db.commit()
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()
    return api_response(message=f'Refugee reassigned to {ngo_name}')
