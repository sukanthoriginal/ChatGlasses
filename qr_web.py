#!/usr/bin/env python3

# All imports organized at the top
import os
import json
import secrets
import uuid
import zlib
import base64
import time
import threading
import jwt
import requests
import logging
from pathlib import Path
from datetime import datetime, timezone
from threading import Lock

# Flask imports
from flask import Flask, render_template, jsonify, session, send_from_directory, request, redirect, url_for, flash
from flask_socketio import SocketIO, emit

# Third party imports
import qrcode
from dotenv import load_dotenv

# Configure logging properly
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration class
class Config:
    QR_EXPIRATION_TIME = 60  # seconds
    CLEANUP_INTERVAL = 60  # seconds
    MAX_QR_FILE_AGE = 300  # 5 minutes
    SESSION_LIFETIME = 3600  # 1 hour

# Thread-safe authentication manager
class AuthenticationManager:
    def __init__(self):
        self._sessions = {}
        self._lock = Lock()
    
    def add_session(self, browser_session, user_data):
        with self._lock:
            self._sessions[browser_session] = user_data
            logger.info(f"Added authentication for session: {browser_session}")
    
    def get_session(self, browser_session):
        with self._lock:
            return self._sessions.get(browser_session)
    
    def remove_session(self, browser_session):
        with self._lock:
            result = self._sessions.pop(browser_session, None)
            if result:
                logger.info(f"Removed authentication for session: {browser_session}")
            return result
    
    def cleanup_expired_sessions(self):
        """Remove sessions older than SESSION_LIFETIME"""
        current_time = time.time()
        expired_sessions = []
        
        with self._lock:
            for session_id, session_data in self._sessions.items():
                if current_time - session_data.get('timestamp', 0) > Config.SESSION_LIFETIME:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                self._sessions.pop(session_id, None)
        
        if expired_sessions:
            logger.info(f"Cleaned up {len(expired_sessions)} expired sessions")

# Initialize Flask app
app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize authentication manager
auth_manager = AuthenticationManager()
session_socket_map = {}

# Load environment variables
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
dotenv_path = os.path.join(project_root, 'mentra.env')
load_dotenv(dotenv_path)

# Validate required environment variables
required_env_vars = ['JWT_SECRET_KEY', 'DEV_AUGMENT_API_KEY', 'DEV_AUGMENT_PACKAGE']
missing_vars = [var for var in required_env_vars if not os.environ.get(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {missing_vars}")

JWT_SECRET = os.environ.get('JWT_SECRET_KEY')
AUGMENTOS_API_KEY = os.environ.get('DEV_AUGMENT_API_KEY')
PACKAGE_NAME = os.environ.get('DEV_AUGMENT_PACKAGE')

# Create directories
STATIC_DIR = Path("static")
QR_DIR = STATIC_DIR / "qr_codes"
TEMPLATE_DIR = STATIC_DIR / "templates"

QR_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

# Store active QR codes
active_qr_codes = {}
active_qr_codes_lock = Lock()

# Utility functions for standardized responses
def create_error_response(message: str, status_code: int = 400):
    """Create standardized error response"""
    return jsonify({
        "status": "error",
        "message": message,
        "timestamp": datetime.utcnow().isoformat()
    }), status_code

def create_success_response(data: dict = None, message: str = "Success"):
    """Create standardized success response"""
    response = {
        "status": "success",
        "message": message,
        "timestamp": datetime.utcnow().isoformat()
    }
    if data:
        response["data"] = data
    return jsonify(response)

def sanitize_user_id(user_id: str) -> str:
    """Sanitize user ID by replacing '@' and '.' with underscores."""
    if not user_id:
        raise ValueError("User ID cannot be empty")
    return user_id.replace('@', '_').replace('.', '_')

def verify_token(token: str) -> dict:
    """
    Verify and decode a JWT token
    
    Args:
        token: The JWT token to verify
        
    Returns:
        dict: The decoded payload if valid, None if invalid
    """
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired")
        return None
    except jwt.InvalidTokenError:
        logger.warning("Invalid token")
        return None
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return None

def generate_qr_for_session(browser_session: str) -> dict:
    """
    Generate a QR code specifically for a browser session
    
    Args:
        browser_session: Unique identifier for the browser session
        
    Returns:
        Dictionary containing QR code data and metadata
        
    Raises:
        IOError: If QR code file cannot be created
    """
    try:
        # Create unique identifiers
        session_id = str(uuid.uuid4())
        nonce = secrets.token_urlsafe(16)
        current_time = time.time()
        
        # Create payload
        payload = {
            "session_id": session_id, 
            "nonce": nonce,
            "browser_session": browser_session,
            "created_at": current_time,
            "expires_at": current_time + Config.QR_EXPIRATION_TIME
        }
        
        # Compress and encode
        compressed = zlib.compress(json.dumps(payload).encode())
        b64 = base64.urlsafe_b64encode(compressed).decode()
        
        # Generate filename and path
        qr_filename = f"qr_{browser_session}_{uuid.uuid4().hex[:8]}.png"
        qr_path = QR_DIR / qr_filename
        
        # Create QR code
        img = qrcode.make(b64)
        img.save(qr_path)
        
        # Store payload safely
        with active_qr_codes_lock:
            active_qr_codes[b64] = payload
        
        # Cleanup old QR codes for this session
        cleanup_old_session_qr_codes(browser_session, qr_path)
        
        logger.info(f"Generated QR code for session: {browser_session}")
        
        return {
            "session_id": session_id,
            "nonce": nonce,
            "browser_session": browser_session,
            "qr_filename": qr_filename,
            "qr_path": f"/qr/{qr_filename}",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(current_time)),
            "expires_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(current_time + Config.QR_EXPIRATION_TIME)),
            "expiration_time": Config.QR_EXPIRATION_TIME,
            "raw_created": current_time,
            "raw_expires": current_time + Config.QR_EXPIRATION_TIME,
            "payload": b64
        }
    
    except Exception as e:
        logger.error(f"Failed to generate QR code: {e}")
        raise IOError(f"QR code generation failed: {e}")

def cleanup_old_session_qr_codes(browser_session: str, current_qr_path: Path):
    """Clean up old QR codes for a specific session"""
    try:
        for old_file in QR_DIR.glob(f"qr_{browser_session}_*.png"):
            if old_file != current_qr_path:
                old_file.unlink()
    except Exception as e:
        logger.warning(f"Error cleaning up old QR codes: {e}")

def is_qr_expired(qr_data: dict) -> bool:
    """Check if QR code is expired"""
    if not qr_data:
        return True
    
    current_time = time.time()
    expires_at = qr_data.get('raw_expires', 0)
    return current_time >= expires_at

def exchange_token_for_user_id(temp_token: str) -> str:
    """
    Exchange the temporary token for a user ID via the AugmentOS API
    
    Args:
        temp_token: The temporary token to exchange
        
    Returns:
        str: Sanitized user ID
        
    Raises:
        Exception: If token exchange fails
    """
    if not temp_token:
        raise ValueError("Temporary token cannot be empty")
    
    endpoint = 'https://prod.augmentos.cloud/api/auth/exchange-user-token'
    
    logger.info(f"Exchanging token with AugmentOS API")
    
    try:
        response = requests.post(
            endpoint,
            json={
                'aos_temp_token': temp_token,
                'packageName': PACKAGE_NAME
            },
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {AUGMENTOS_API_KEY}'
            },
            timeout=10  # Increased timeout
        )
        
        logger.info(f"API Response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success') and data.get('userId'):
                return sanitize_user_id(data['userId'])
            else:
                raise Exception(f"Unexpected API response: {data}")
        
        # Handle specific error cases
        error_text = response.text.lower()
        if "max entries" in error_text:
            raise Exception("Rate limit reached: Maximum entries exceeded. Please try again later.")
        
        try:
            error_data = response.json()
            error_message = error_data.get('error', f'HTTP {response.status_code}')
        except:
            error_message = f'HTTP {response.status_code}: {response.text[:100]}'
        
        raise Exception(f"Token exchange failed: {error_message}")
        
    except requests.exceptions.Timeout:
        logger.error("API request timeout")
        raise Exception("Connection timeout. Please try again.")
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error: {str(e)}")
        raise Exception(f"Connection error: {str(e)}")

# Routes
@app.route('/')
def index():
    """Main page with QR code for authentication"""
    try:
        if 'browser_session' not in session:
            session['browser_session'] = secrets.token_urlsafe(8)
        
        browser_session = session['browser_session']
        qr_data = generate_qr_for_session(browser_session)
        session['qr_data'] = qr_data
        
        return render_template('index.html', 
                             qr_path=qr_data['qr_path'],
                             expiration_time=qr_data['expiration_time'],
                             browser_session=browser_session)
    except Exception as e:
        logger.error(f"Error in index route: {e}")
        return create_error_response("Failed to generate QR code", 500)

@app.route('/refresh-qr')
def refresh_qr():
    """Generate a new QR code for the current session"""
    try:
        browser_session = session.get('browser_session', secrets.token_urlsafe(8))
        qr_data = generate_qr_for_session(browser_session)
        session['qr_data'] = qr_data
        
        return jsonify(qr_data)
    except Exception as e:
        logger.error(f"Error refreshing QR code: {e}")
        return create_error_response("Failed to refresh QR code", 500)

@app.route('/check-qr-status')
def check_qr_status():
    """Check if current QR code is expired"""
    qr_data = session.get('qr_data')
    expired = is_qr_expired(qr_data)
    
    time_remaining = 0
    if qr_data and not expired:
        time_remaining = max(0, int(qr_data.get('raw_expires', 0) - time.time()))
    
    return jsonify({
        "expired": expired,
        "time_remaining": time_remaining
    })

@app.route('/qr/<filename>')
def serve_qr(filename):
    """Serve QR code images"""
    try:
        return send_from_directory(QR_DIR, filename)
    except FileNotFoundError:
        return create_error_response("QR code not found", 404)

@app.route('/api/scan', methods=['POST'])
def receive_scan():
    """Handle QR code scan from mobile device"""
    try:
        data = request.get_json()
        if not data:
            return create_error_response("No data provided")
        
        secure_token = data.get("secure_token")
        if not secure_token:
            return create_error_response("Missing authentication token")

        # Verify token
        token_data = verify_token(secure_token)
        if not token_data:
            return create_error_response("Authentication failed", 401)
        
        user_id = token_data.get('user_id')
        scanned_url = token_data.get('scanned_url')
        
        if not user_id or not scanned_url:
            return create_error_response("Invalid authentication data", 400)
        
        logger.info(f"Authentication successful for user: {user_id}")
        
        # Process QR code
        browser_session = None
        with active_qr_codes_lock:
            if scanned_url in active_qr_codes:
                browser_session = active_qr_codes[scanned_url].get('browser_session')
        
        if browser_session:
            # Store authentication
            auth_manager.add_session(browser_session, {
                'user_id': user_id,
                'authenticated': True,
                'timestamp': time.time()
            })
            
            # Notify browser via WebSocket
            if browser_session in session_socket_map:
                socketio.emit('authentication_successful', 
                            {'redirect': '/dashboard'}, 
                            room=session_socket_map[browser_session])
        
        # Set session for mobile request
        session['user_id'] = user_id
        session['authenticated'] = True
        session.modified = True
        
        return create_success_response({
            "user_id": user_id,
            "redirect": "/dashboard"
        }, "Authentication successful")
    
    except Exception as e:
        logger.error(f"Error processing scan: {e}")
        return create_error_response(f"Authentication failed: {str(e)}", 500)

@app.route('/check-authenticated')
def check_authenticated():
    """Check if the current browser session is authenticated"""
    is_authenticated = session.get('authenticated', False)
    
    # Check authentication manager if not in session
    if not is_authenticated:
        browser_session = session.get('browser_session')
        if browser_session:
            auth_data = auth_manager.get_session(browser_session)
            if auth_data:
                # Copy to session
                session['user_id'] = auth_data['user_id']
                session['authenticated'] = True
                session.modified = True
                
                # Remove from auth manager
                auth_manager.remove_session(browser_session)
                is_authenticated = True
    
    return jsonify({"authenticated": is_authenticated})

@app.route('/dashboard')
def dashboard():
    """Dashboard page for authenticated users"""
    is_authenticated = session.get('authenticated', False)
    
    # Double-check with auth manager
    if not is_authenticated:
        browser_session = session.get('browser_session')
        if browser_session:
            auth_data = auth_manager.get_session(browser_session)
            if auth_data:
                session['user_id'] = auth_data['user_id']
                session['authenticated'] = True
                session.modified = True
                auth_manager.remove_session(browser_session)
                is_authenticated = True
    
    if not is_authenticated:
        logger.info("Unauthenticated access attempt to Dashboard page")
        return redirect(url_for('index'))
    
    user_id = session.get('user_id', 'User')
    logger.info(f"Rendering Dashboard page for user: {user_id}")
    
    return render_template('dashboard.html', user_id=user_id)

@app.route('/logout')
def logout():
    """Logout and clear session"""
    browser_session = session.get('browser_session')
    user_id = session.get('user_id')
    
    # Clear session
    session.clear()
    
    # Clean up auth manager
    if browser_session:
        auth_manager.remove_session(browser_session)
    
    logger.info(f"User {user_id} logged out from session: {browser_session}")
    return redirect(url_for('index'))

# WebSocket events
@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    if 'browser_session' in session:
        session_socket_map[session['browser_session']] = request.sid
        logger.info(f"WebSocket connected for session: {session['browser_session']}")

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    if 'browser_session' in session:
        browser_session = session['browser_session']
        if browser_session in session_socket_map:
            del session_socket_map[browser_session]
            logger.info(f"WebSocket disconnected for session: {browser_session}")

# Background cleanup tasks
def cleanup_old_qr_codes():
    """Clean up expired QR codes and sessions"""
    while True:
        try:
            current_time = time.time()
            
            # Clean up QR code files
            for qr_file in QR_DIR.glob("*.png"):
                if current_time - qr_file.stat().st_mtime > Config.MAX_QR_FILE_AGE:
                    try:
                        qr_file.unlink()
                    except Exception as e:
                        logger.warning(f"Failed to delete QR file {qr_file}: {e}")
            
            # Clean up expired QR codes from memory
            expired_codes = []
            with active_qr_codes_lock:
                for code, payload in active_qr_codes.items():
                    if current_time > payload.get('expires_at', 0):
                        expired_codes.append(code)
                
                for code in expired_codes:
                    active_qr_codes.pop(code, None)
            
            # Clean up expired authentication sessions
            auth_manager.cleanup_expired_sessions()
            
            if expired_codes:
                logger.info(f"Cleaned up {len(expired_codes)} expired QR codes")
                
        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")
        
        time.sleep(Config.CLEANUP_INTERVAL)

# Start background cleanup
cleanup_thread = threading.Thread(target=cleanup_old_qr_codes, daemon=True)
cleanup_thread.start()

# Set template folder
app.template_folder = TEMPLATE_DIR

if __name__ == '__main__':
    logger.info("Starting Flask server at http://localhost:5000")
    socketio.run(app, host='localhost', port=5000, debug=True)