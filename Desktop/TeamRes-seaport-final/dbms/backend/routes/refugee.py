from flask import Blueprint
from database import get_db, row_to_dict, api_response, api_error

refugee_bp = Blueprint('refugee', __name__)


@refugee_bp.route('/lookup/<provisional_id>', methods=['GET'])
def lookup(provisional_id):
    provisional_id = provisional_id.strip().upper()
    if not provisional_id.startswith('PROV-'):
        return api_error('Invalid provisional ID format. Expected: PROV-FORCE-YEAR-NUMBER', 400)

    db = get_db()
    try:
        row = db.execute("""
            SELECT rr.provisional_id, rr.force, rr.entry_point, rr.registration_date,
                   rr.assigned_camp, rr.assigned_ngo, rr.help_tags, rr.status AS reg_status,
                   e.name, e.nationality, e.dob, e.gender, e.medical_needs,
                   e.status AS entity_status, e.assigned_camp AS entity_camp,
                   na.ngo_name, na.status AS ngo_status
            FROM refugee_registrations rr
            JOIN entities e ON e.id = rr.entity_id
            LEFT JOIN ngo_assignments na ON na.refugee_registration_id = rr.id
            WHERE rr.provisional_id = ?
        """, (provisional_id,)).fetchone()
    finally:
        db.close()

    if not row:
        return api_error(
            'No record found for this Provisional ID. Please contact the officer who registered you.',
            404
        )

    data = dict(row)
    # Add rights and camp info
    data['rights'] = [
        'You have the right to non-refoulement — you cannot be returned to a country where you face danger.',
        'You have the right to seek asylum and have your claim individually assessed.',
        'You have the right to basic shelter, food, and medical care during processing.',
        'You have the right to speak with UNHCR and legal aid representatives.',
        'Children have additional rights under the UN Convention on the Rights of the Child.',
    ]
    data['emergency_contacts'] = [
        {'label': 'UNHCR India Helpline', 'number': '+91-11-4653-7444'},
        {'label': 'NHRC Helpline',        'number': '14433'},
        {'label': 'Police Emergency',      'number': '100'},
        {'label': 'Medical Emergency',     'number': '108'},
    ]
    return api_response(data=data)
