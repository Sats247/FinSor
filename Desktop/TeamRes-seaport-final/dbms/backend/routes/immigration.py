import os, random, string
from flask import Blueprint, request, send_from_directory
from database import get_db, row_to_dict, rows_to_list, api_response, api_error
from werkzeug.utils import secure_filename

immigration_bp = Blueprint('immigration', __name__)

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), '..', 'uploads', 'photos')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# The demo passport data for Vikram Singh
DEMO_PASSPORT = {
    'passport_no':  'Z8892104',
    'name':         'Vikram Singh',
    'nationality':  'Indian',
    'dob':          '1988-03-15',
    'gender':       'Male',
    'place_of_birth': 'New Delhi',
    'date_of_issue':  '2021-01-12',
    'date_of_expiry': '2031-01-11',
    'mrz_line1': 'P<INDSINGH<<VIKRAM<<<<<<<<<<<<<<<<<<<<<<<<',
    'mrz_line2': 'Z88921048IND8803154M3101118<<<<<<<<<<<<<<<6'
}


@immigration_bp.route('/verify-passport', methods=['POST'])
def verify_passport():
    data     = request.get_json(silent=True) or {}
    pno      = data.get('passport_no', '').strip()
    ocr_name = data.get('ocr_name', '').strip()

    if not pno and not ocr_name:
        return api_error('passport_no or ocr_name required')

    db = get_db()
    try:
        row = None
        if pno:
            row = db.execute("SELECT * FROM entities WHERE passport_no=?", (pno,)).fetchone()
        if not row and ocr_name:
            row = db.execute(
                "SELECT * FROM entities WHERE name LIKE ?",
                (f'%{ocr_name.split()[0]}%',)
            ).fetchone()
    finally:
        db.close()

    if row:
        r = dict(row)
        face_match = 96 if r['passport_no'] == 'Z8892104' else (
            0 if r['is_blacklist'] else
            (int(85 + (100 - r['risk_score']) * 0.1))
        )
        checks = {
            'mrz_valid':        r['is_blacklist'] == 0,
            'not_expired':      True,
            'watchlist_clear':  r['is_blacklist'] == 0,
            'interpol_clear':   r['is_blacklist'] == 0,
            'face_match_score': face_match,
        }
        overall = 'Verified' if all(checks[k] for k in checks if k != 'face_match_score') and face_match > 80 else 'Flagged'
        return api_response(data={
            'found':          True,
            'entity':         r,
            'checks':         checks,
            'overall_status': overall,
            'is_blacklist':   bool(r['is_blacklist']),
            'blacklist_reason': r.get('blacklist_reason')
        })

    return api_response(data={
        'found':          False,
        'entity':         None,
        'checks': {
            'mrz_valid':        True,
            'not_expired':      True,
            'watchlist_clear':  True,
            'interpol_clear':   True,
            'face_match_score': 72,
        },
        'overall_status': 'Pending'
    }, message='Document scanned — manual review recommended')


@immigration_bp.route('/travelers', methods=['GET'])
def search_travelers():
    q      = request.args.get('q', '').strip()
    status = request.args.get('status', '')
    nat    = request.args.get('nationality', '')
    limit  = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    conditions = ["type='Traveler'"]
    params     = []
    if q:
        conditions.append("(name LIKE ? OR passport_no LIKE ?)")
        params += [f'%{q}%', f'%{q}%']
    if status:
        conditions.append("status=?")
        params.append(status)
    if nat:
        conditions.append("nationality LIKE ?")
        params.append(f'%{nat}%')

    where = ' AND '.join(conditions)
    db = get_db()
    try:
        rows  = db.execute(
            f"SELECT * FROM entities WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as c FROM entities WHERE {where}", params
        ).fetchone()['c']
    finally:
        db.close()

    return api_response(data={'items': [dict(r) for r in rows], 'total': total})


@immigration_bp.route('/travelers/<entity_id>', methods=['GET'])
def get_traveler(entity_id):
    """Fetch a single traveler by ID (used by the Edit modal)."""
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
        ).fetchone()
    finally:
        db.close()
    if not row:
        return api_error('Traveler not found', 404)
    return api_response(data=dict(row))


@immigration_bp.route('/travelers', methods=['POST'])
def add_traveler():
    """Create a new Traveler entity."""
    data = request.get_json(silent=True) or {}
    required = ['name', 'nationality']
    for f in required:
        if not data.get(f):
            return api_error(f'Field required: {f}')

    entity_id   = f"BMS-TRV-{random.randint(10000,99999)}"
    passport_no = data.get('passport_no') or f"TEMP-TRV-{random.randint(1000,9999)}"
    # Status drives blacklist flag: 'Blacklisted' status → is_blacklist=1
    status      = data.get('status', 'Under Verification')
    blacklisted = 1 if (data.get('blacklisted') or status == 'Blacklisted') else 0

    db = get_db()
    try:
        db.execute("""
            INSERT INTO entities
              (id, name, passport_no, nationality, type, entry_point, status,
               risk_score, is_blacklist, dob, gender, visit_reason, visa_status,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
        """, (
            entity_id, data['name'], passport_no, data['nationality'],
            'Traveler',
            data.get('entry_point', ''),
            status,
            int(data.get('risk_score', 0)),
            blacklisted,
            data.get('dob', ''),
            data.get('gender', ''),
            data.get('visit_reason', ''),
            data.get('visa_status', 'None'),
        ))
        db.commit()
    except Exception as e:
        return api_error(f'Database error: {str(e)}', 500)
    finally:
        db.close()

    return api_response(data={'id': entity_id, 'passport_no': passport_no},
                        message='Traveler added successfully')


@immigration_bp.route('/travelers/<entity_id>', methods=['PATCH'])
def update_traveler(entity_id):
    """Update any field on a Traveler entity."""
    data = request.get_json(silent=True) or {}
    allowed = ['name', 'passport_no', 'nationality', 'gender', 'dob',
               'entry_point', 'visit_reason', 'status', 'visa_status',
               'is_blacklist', 'blacklist_reason', 'risk_score']

    # Map 'blacklisted' convenience field
    if 'blacklisted' in data:
        data['is_blacklist'] = 1 if data.pop('blacklisted') else 0
    # Status drives blacklist flag: setting status='Blacklisted' also sets is_blacklist=1
    if 'status' in data:
        if data['status'] == 'Blacklisted':
            data['is_blacklist'] = 1
        elif data['status'] in ('Verified', 'Under Verification', 'Pending'):
            data.setdefault('is_blacklist', 0)

    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return api_error('No valid fields provided to update')

    set_clause = ', '.join(f"{k}=?" for k in fields)
    values     = list(fields.values()) + [entity_id]

    db = get_db()
    try:
        db.execute(
            f"UPDATE entities SET {set_clause}, updated_at=datetime('now') WHERE id=? AND type='Traveler'",
            values
        )
        db.commit()
        changed = db.execute("SELECT changes() as n").fetchone()['n']
        if changed == 0:
            return api_error('Traveler not found', 404)
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(message='Traveler updated successfully')


@immigration_bp.route('/travelers/<entity_id>', methods=['DELETE'])
def delete_traveler(entity_id):
    """Delete a Traveler entity."""
    db = get_db()
    try:
        db.execute(
            "DELETE FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
        )
        db.commit()
        changed = db.execute("SELECT changes() as n").fetchone()['n']
        if changed == 0:
            return api_error('Traveler not found', 404)
    except Exception as e:
        return api_error(str(e), 500)
    finally:
        db.close()

    return api_response(message='Traveler deleted')


@immigration_bp.route('/travelers/<entity_id>/photo', methods=['POST'])
def upload_photo(entity_id):
    """Store a passport photo associated with the traveler entity."""
    if 'photo' not in request.files:
        return api_error('No photo file provided')

    photo = request.files['photo']
    if not photo.filename:
        return api_error('Empty filename')

    ext      = os.path.splitext(secure_filename(photo.filename))[1].lower() or '.jpg'
    filename = f"{entity_id}{ext}"
    save_path = os.path.join(UPLOADS_DIR, filename)
    photo.save(save_path)

    # Store relative path reference in passport_photo column
    photo_url = f"/uploads/photos/{filename}"
    db = get_db()
    try:
        db.execute(
            "UPDATE entities SET passport_photo=?, updated_at=datetime('now') WHERE id=?",
            (photo_url, entity_id)
        )
        db.commit()
    finally:
        db.close()

    return api_response(data={'photo_url': photo_url}, message='Photo uploaded successfully')


@immigration_bp.route('/grant-entry', methods=['POST'])
def grant_entry():
    data = request.get_json(silent=True) or {}
    passport_no = data.get('passport_no', '')
    if not passport_no:
        return api_error('passport_no required')

    db = get_db()
    try:
        db.execute(
            "UPDATE entities SET status='Verified', updated_at=datetime('now') WHERE passport_no=?",
            (passport_no,)
        )
        db.commit()
    finally:
        db.close()

    return api_response(message=f'Entry granted for passport {passport_no}')
