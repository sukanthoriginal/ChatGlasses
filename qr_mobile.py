# qr_mobile.py
#!/usr/bin/env python3
import os
from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, session
from supabase import create_client
from dotenv import load_dotenv
import uuid
from datetime import datetime, timezone
import requests
import logging
import jwt
import time
from token_handler import generate_qr_token

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
app.secret_key = os.urandom(24)  # For flash messages and session


project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))

# Build full path to .env file
dotenv_path = os.path.join(project_root, 'mentra.env')
load_dotenv(dotenv_path)
# Load API key and package name from environment variables for AugmentOS
AUGMENTOS_API_KEY = os.environ.get('DEV_AUGMENT_API_KEY')
PACKAGE_NAME = os.environ.get('DEV_AUGMENT_PACKAGE')

def sanitize_user_id(user_id):
    """Sanitize user ID by replacing '@' and '.' with underscores."""
    return user_id.replace('@', '_').replace('.', '_')


def exchange_token_for_user_id(temp_token):
    """Exchange the temporary token for a user ID via the AugmentOS API"""
    endpoint = 'https://prod.augmentos.cloud/api/auth/exchange-user-token'
    
    # Log the request details for debugging
    logging.info(f"Sending request to {endpoint} with token: {temp_token}")
    
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
            timeout=5
        )
        
        # Log the response for debugging
        logging.info(f"Response status: {response.status_code}")
        logging.info(f"Response body: {response.text[:200]}...")  # Log first 200 chars
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success') and data.get('userId'):
                return sanitize_user_id(data['userId'])
            elif "max entries" in response.text.lower():
                raise Exception("Rate limit reached: Maximum entries exceeded. Please try again later.")
            else:
                raise Exception(f"Unexpected response: {data}")
        
        # Extract error message if possible
        try:
            data = response.json()
            error_message = data.get('error', f'Status {response.status_code}')
            
            # Check for "max entries" in the error message
            if "max entries" in response.text.lower():
                error_message = "Rate limit reached: Maximum entries exceeded. Please try again later."
            
        except:
            error_message = f'Status {response.status_code}: {response.text}'
        
        raise Exception(f"Token exchange failed: {error_message}")
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Network error: {str(e)}")
        raise Exception(f"Connection error: {str(e)}")
    



def is_authenticated():
    """Check if the current session is authenticated"""
    return session.get('authenticated', False)

def generate_new_token(user_id):
    endpoint = 'https://prod.augmentos.cloud/api/auth/generate-user-token'
    try:
        response = requests.post(
            endpoint,
            json={'userId': user_id, 'packageName': PACKAGE_NAME},
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {AUGMENTOS_API_KEY}'
            },
            timeout=5
        )
        response.raise_for_status()
        data = response.json()
        if data.get('success') and data.get('token'):
            return data['token']
        raise Exception(f"Token generation failed: {data}")
    except Exception as e:
        logging.error(f"Token generation error: {e}")
        raise



@app.route('/webview', methods=['GET'])
def webview():
    temp_token = request.args.get('aos_temp_token')

    if not temp_token:
        # No token - show authentication required page
        #session['user_id'] = DEFAULT_USER_ID
        return render_template(
            'auth_required.html',
            token_message="Authentication required to access camera"
        )

    try:
        user_id = exchange_token_for_user_id(temp_token)
        session['user_id'] = user_id
        session['authenticated'] = True



        return render_template(
            'camera.html',
            user_id=user_id,
            token_message="Authenticated successfully"
            

        )

    except Exception as e:
        logging.error(f"Authentication failed: {str(e)}")
        # Authentication failed - show auth required page
        return render_template(
            'auth_required.html',
            token_message=f"Authentication failed: {str(e)}"
        )

@app.route('/webview/authenticate', methods=['POST'])
def authenticate():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    data = request.get_json(silent=True)
    if not data or 'scanned_url' not in data:
        return jsonify({'success': False, 'error': 'Missing scanned_url'}), 400

    scanned_url = data['scanned_url']
    user_id = session.get('user_id')
    
    # Generate secure token containing both user_id and scanned_url
    secure_token = generate_qr_token(user_id, scanned_url)
    
    now = datetime.now()

    try:
        # Only send the secure_token to the desktop app - no additional data needed
        desktop_response = requests.post(
            "https://qr-dashboard.sukanthoriginal.com/api/scan",
            json={
                'secure_token': secure_token
            },
            timeout=3
        )
        desktop_response.raise_for_status()
        logging.info(f"Successfully forwarded to desktopview: {desktop_response.status_code}")
    except Exception as e:
        logging.warning(f"Failed to forward to desktopview: {str(e)}")

    return jsonify({
        'success': True,
    }), 200
    
if __name__ == "__main__":
    # Run the Flask application on port 96
    app.run(host='0.0.0.0', port=96, debug=True)

application = app
