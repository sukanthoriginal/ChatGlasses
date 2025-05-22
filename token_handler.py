#!/usr/bin/env python3
import jwt
import time
import os
import secrets
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

JWT_SECRET = # Fetch your JWT Secret
JWT_ALGORITHM = 'HS256'

def generate_qr_token(user_id, scanned_url=None):
    """
    Generate a secure JWT token containing user ID and optionally the scanned URL
    
    Args:
        user_id (str): The authenticated user's ID
        scanned_url (str, optional): The scanned QR code URL
        
    Returns:
        str: JWT token as secure_token
    """
    # Create payload with minimized data - just what's needed for security
    payload = {
        'user_id': user_id,
        'iat': int(time.time()),  # Issued at time
        'exp': int(time.time()) + 300,  # Expire after 5 minutes (5 min = 300 sec)
        'jti': secrets.token_hex(8)  # Unique token ID for preventing replay attacks
    }
    
    # Add scanned URL if provided - only essential field besides user_id
    if scanned_url:
        payload['scanned_url'] = scanned_url
    
    try:
        # Create and return the token - this will be the only data transferred
        secure_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        logging.info(f"Generated secure token for user: {user_id}")
        return secure_token
    except Exception as e:
        logging.error(f"Error generating secure token: {str(e)}")
        raise

def verify_token(secure_token):
    """
    Verify and decode a secure JWT token
    
    Args:
        secure_token (str): The JWT token to verify
        
    Returns:
        dict: The decoded payload if valid
        None: If the token is invalid or expired
    """
    if not secure_token:
        logging.warning("Empty secure token provided for verification")
        return None
        
    try:
        # Decode and verify the secure token - extracts original payload
        payload = jwt.decode(secure_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        logging.info(f"Successfully verified secure token for user: {payload.get('user_id')}")
        return payload
    except jwt.ExpiredSignatureError:
        # Token expired
        logging.warning("Secure token verification failed: Token expired")
        return None
    except jwt.InvalidTokenError as e:
        # Token invalid
        logging.warning(f"Secure token verification failed: Invalid token - {str(e)}")
        return None
    except Exception as e:
        # Unexpected error
        logging.error(f"Secure token verification error: {str(e)}")
        return None