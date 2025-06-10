#!/usr/bin/env python3
"""
Database helper script for ChatGlasses app
This script provides command-line interface to the contacts database
"""

import os
from supabase import create_client, Client
from typing import List, Dict, Optional
from datetime import datetime
from dotenv import load_dotenv

import sys
import json
from contacts_backend import ContactsManager

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)
    
    command = sys.argv[1]
    contacts = ContactsManager()
    
    try:
        if command == "get_contacts":
            if len(sys.argv) < 3:
                print(json.dumps({"error": "Email required"}))
                sys.exit(1)
            
            email = sys.argv[2]
            result = contacts.get_contacts(email, include_blocked=False)
            print(json.dumps(result))
            
        elif command == "get_nickname":
            if len(sys.argv) < 4:
                print(json.dumps({"error": "User email and contact email required"}))
                sys.exit(1)
            
            user_email = sys.argv[2]
            contact_email = sys.argv[3]
            result = contacts.get_nickname(user_email, contact_email)
            print(json.dumps(result))
            
        elif command == "is_blocked":
            if len(sys.argv) < 4:
                print(json.dumps({"error": "User email and contact email required"}))
                sys.exit(1)
            
            user_email = sys.argv[2]
            contact_email = sys.argv[3]
            result = contacts.is_blocked(user_email, contact_email)
            print(json.dumps(result))
            
        elif command == "add_contact":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "User email, contact email, and nickname required"}))
                sys.exit(1)
            
            user_email = sys.argv[2]
            contact_email = sys.argv[3]
            nickname = sys.argv[4]
            result = contacts.add_contact(user_email, contact_email, nickname)
            print(json.dumps(result))
            
        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)
            
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()