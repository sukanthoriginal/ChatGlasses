import sys
from datetime import datetime
import os
from supabase import create_client
from dotenv import load_dotenv
from collections import defaultdict
import json

def init_supabase():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    dotenv_path = os.path.join(base_dir, 'mentra.env')
    load_dotenv(dotenv_path=dotenv_path)
    
    supabase_url = os.getenv("CHATGLASSES_SUPABASE_URL")
    supabase_service = os.getenv("CHATGLASSES_SUPABASE_SERVICE")
    
    if not supabase_url or not supabase_service:
        raise EnvironmentError("Supabase credentials not found in environment variables")
    
    return create_client(supabase_url, supabase_service)

def save_message(chat_id, user_id, message):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    formatted_message = f"[{timestamp}] CHAT_ID={chat_id} USER_ID={user_id} MESSAGE={message}\n"

    with open("chat_history.txt", "a", encoding="utf-8") as f:
        f.write(formatted_message)

if __name__ == '__main__':
    save_message(sys.argv[1], sys.argv[2], sys.argv[3])
