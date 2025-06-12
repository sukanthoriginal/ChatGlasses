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

def get_all_blocked_pairs(supabase):
    """
    Get all blocked relationships in both directions
    Returns a set of tuples: (blocker_email, blocked_email)
    """
    try:
        response = supabase.table("contacts") \
            .select("user_id, contact_email") \
            .eq("is_blocked", True) \
            .execute()
        
        blocked_pairs = set()
        for row in response.data:
            # Add both directions of the block
            blocked_pairs.add((row['user_id'], row['contact_email']))
            blocked_pairs.add((row['contact_email'], row['user_id']))
        
        return blocked_pairs
    except Exception as e:
        print(f"Warning: Could not fetch blocked relationships: {e}")
        return set()

def build_nested_map(data, blocked_pairs):
    """
    Builds a nested dict: { user_id: { contact_email: nickname } }
    Excludes any relationships where either user has blocked the other
    """
    nested_map = defaultdict(dict)
    for row in data:
        user = row['user_id']
        contact = row['contact_email']
        nickname = row['nickname']
        
        # Skip if either user has blocked the other
        if (user, contact) not in blocked_pairs:
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
    try:
        supabase = init_supabase()
        response = supabase.table("contacts").select("*").execute()
        blocked_pairs = get_all_blocked_pairs(supabase)
        nested = build_nested_map(response.data, blocked_pairs)
        ts_output = generate_typescript_map(nested)
        print(ts_output)
    except Exception as e:
        # Avoid Unicode issue
        print("Error:", e)