# contacts_frontend.py
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
from contacts_backend import ContactsManager

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
app.secret_key = os.urandom(24)  # For flash messages and session
contacts_manager = ContactsManager()

# Load environment variables
base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
dotenv_path = os.path.join(base_dir, 'mentra.env')
load_dotenv(dotenv_path=dotenv_path)

# Load API key and package name from environment variables for AugmentOS
AUGMENTOS_API_KEY = os.environ.get('DEV_AUGMENT_API_KEY')
PACKAGE_NAME = os.environ.get('DEV_AUGMENT_PACKAGE')


def exchange_token_for_user_id(temp_token):
    """Exchange the temporary token for a user ID via the AugmentOS API"""
    endpoint = 'https://prod.augmentos.cloud/api/auth/exchange-user-token'
    
    # Log the request details for debugging
    logging.info(f"Sending request to {endpoint} with token: {temp_token}")
    print(temp_token)
    print(PACKAGE_NAME)
    print(AUGMENTOS_API_KEY)
    
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
                return data['userId']
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
    """Check if user is authenticated via webview"""
    return 'user_id' in session

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



@app.route('/')
def index():
    if not is_authenticated():
        return redirect(url_for('webview'))
    return redirect(url_for('contacts'))


@app.route('/add_contact', methods=['POST'])
def add_contact():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    contact_email = request.form.get('contact_email')
    nickname = request.form.get('nickname')
    
    if contacts_manager.add_contact(user_id, contact_email, nickname):
        flash('Contact added successfully!', 'success')
    else:
        flash('Failed to add contact. Contact might already exist.', 'error')
    
    return redirect(url_for('contacts'))

@app.route('/update_nickname', methods=['POST'])
def update_nickname():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    contact_email = request.form.get('contact_email')
    new_nickname = request.form.get('new_nickname')
    
    if contacts_manager.update_nickname(user_id, contact_email, new_nickname):
        flash('Nickname updated successfully!', 'success')
    else:
        flash('Failed to update nickname.', 'error')
    
    return redirect(url_for('contacts'))

@app.route('/block_contact/<contact_email>')
def block_contact(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.block_contact(user_id, contact_email):
        flash('Contact blocked successfully!', 'success')
    else:
        flash('Failed to block contact.', 'error')
    
    return redirect(url_for('contacts'))

@app.route('/unblock_contact/<contact_email>')
def unblock_contact(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.unblock_contact(user_id, contact_email):
        flash('Contact unblocked successfully!', 'success')
    else:
        flash('Failed to unblock contact.', 'error')
    
    return redirect(url_for('contacts'))

@app.route('/remove_contact/<contact_email>')
def remove_contact(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.remove_contact(user_id, contact_email):
        flash('Contact removed successfully!', 'success')
    else:
        flash('Failed to remove contact.', 'error')
    
    return redirect(url_for('contacts'))

@app.route('/logout')
def logout():
    session.pop('user_email', None)
    return redirect(url_for('login'))

@app.route('/webview', methods=['GET'])
def webview():
    temp_token = request.args.get('aos_temp_token')
    print(temp_token)
    #print(PACKAGE_NAME)
    #print(AUGMENTOS_API_KEY)

    if not temp_token:
        # No token - show authentication required page
        #session['user_id'] = DEFAULT_USER_ID
        print("Not validated yet")
        return render_template(
            'frontend.html',
            token_message="Authentication required to access camera",
        )

    try:
        user_id = exchange_token_for_user_id(temp_token)
        print("authenitcated")
        session['user_id'] = user_id
        session['authenticated'] = True

        return render_template(
            'frontend.html',
            user_id=user_id,
            token_message="Authenticated successfully"
        )

    except Exception as e:
        logging.error(f"Authentication failed: {str(e)}")
        print("auth failed because of exception")
        return render_template(
            'auth_required.html',
            token_message=f"Authentication failed: {str(e)}"
        )


@app.route('/frontend')
def frontend():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    contacts_list = contacts_manager.get_contacts(user_id)
    return render_template('frontend.html', contacts=contacts_list, user_id=user_id)

@app.route('/api/add_contact', methods=['POST'])
def add_contact_api():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    data = request.get_json()
    contact_email = data.get('contact_email')
    nickname = data.get('nickname')
    
    if contacts_manager.add_contact(user_id, contact_email, nickname):
        return jsonify({'success': True, 'message': 'Contact added successfully!'})
    return jsonify({'success': False, 'message': 'Failed to add contact'})

@app.route('/api/update_nickname', methods=['POST'])
def update_nickname_api():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    data = request.get_json()
    contact_email = data.get('contact_email')
    new_nickname = data.get('new_nickname')
    
    if contacts_manager.update_nickname(user_id, contact_email, new_nickname):
        return jsonify({'success': True, 'message': 'Nickname updated successfully!'})
    return jsonify({'success': False, 'message': 'Failed to update nickname'})

@app.route('/api/block_contact/<contact_email>', methods=['POST'])
def block_contact_api(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.block_contact(user_id, contact_email):
        return jsonify({'success': True, 'message': 'Contact blocked successfully!'})
    return jsonify({'success': False, 'message': 'Failed to block contact'})

@app.route('/api/get_contacts')
def get_contacts_api():
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    contacts_list = contacts_manager.get_contacts(user_id, include_blocked=True)
    return jsonify(contacts_list)

@app.route('/api/unblock_contact/<contact_email>', methods=['POST'])
def unblock_contact_api(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.unblock_contact(user_id, contact_email):
        return jsonify({'success': True, 'message': 'Contact unblocked successfully!'})
    return jsonify({'success': False, 'message': 'Failed to unblock contact'})

@app.route('/api/remove_contact/<contact_email>', methods=['POST'])
def remove_contact_api(contact_email):
    if not is_authenticated():
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    if contacts_manager.remove_contact(user_id, contact_email):
        return jsonify({'success': True, 'message': 'Contact removed successfully!'})
    return jsonify({'success': False, 'message': 'Failed to remove contact'})

if __name__ == "__main__":
    # Run the Flask application on port 96
    app.run(host='0.0.0.0', port=96, debug=True)

application = app
