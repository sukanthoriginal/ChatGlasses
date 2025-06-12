import sys
from datetime import datetime
import os
from supabase import create_client
from dotenv import load_dotenv
from datetime import datetime, timezone


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
    supabase = init_supabase()
    timestamp = datetime.now(timezone.utc).isoformat()

    response = supabase.table("messages").insert({
        "chat_id": chat_id,
        "user_id": user_id,
        "message": message,
        "timestamp": timestamp
    }).execute()

    if hasattr(response, "error") and response.error:
        print("Error saving message:", response.error)
    else:
        print("Message saved successfully.")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python save_message.py <chat_id> <user_id> <message>")
    else:
        save_message(sys.argv[1], sys.argv[2], sys.argv[3])
