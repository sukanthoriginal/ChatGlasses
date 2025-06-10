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

def build_nested_map(data):
    """
    Builds a nested dict: { user_id: { contact_email: nickname } }
    """
    nested_map = defaultdict(dict)
    for row in data:
        user = row['user_id']
        contact = row['contact_email']
        nickname = row['nickname']
        nested_map[user][contact] = nickname
    return nested_map

def generate_typescript_map(nested_map):
    """
    Outputs the nested dict as a TypeScript Map<string, Map<string, string>> declaration
    """
    lines = ["const personalNicknames = new Map<string, Map<string, string>>(["]

    for user_id, contacts in nested_map.items():
        lines.append(f"  ['{user_id}', new Map([")
        for contact_email, nickname in contacts.items():
            escaped_nickname = json.dumps(nickname)  # auto-escapes quotes etc.
            lines.append(f"    ['{contact_email}', {escaped_nickname}],")
        lines.append("  ])],")
    lines.append("]);")
    return "\n".join(lines)

if __name__ == "__main__":
    supabase = init_supabase()
    try:
        response = supabase.table("contacts").select("*").execute()
        nested = build_nested_map(response.data)
        ts_output = generate_typescript_map(nested)
        print(ts_output)
    except Exception as e:
        print(f"❌ Error: {e}")
