# contacts_backend.py
import os
from supabase import create_client, Client
from typing import List, Dict, Optional
from datetime import datetime
from dotenv import load_dotenv

def init_supabase():
    """Initialize and return Supabase client using environment variables."""
    # Try to find the .env file in the parent directory
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    dotenv_path = os.path.join(base_dir, 'mentra.env')
    
    # Load environment variables
    load_dotenv(dotenv_path=dotenv_path)
    
    # Get Supabase credentials
    supabase_url = os.getenv("CHATGLASSES_SUPABASE_URL")
    supabase_service = os.getenv("CHATGLASSES_SUPABASE_SERVICE")
    
    if not supabase_url or not supabase_service:
        raise EnvironmentError("Supabase credentials not found in environment variables")
    
    return create_client(supabase_url, supabase_service)

# Initialize Supabase client globally
supabase = init_supabase()

class ContactsManager:
    """
    Manages contacts for users - like WhatsApp/Phone contacts
    """
    
    def __init__(self):
        """Initialize ContactsManager with Supabase client"""
        self.supabase = supabase
    
    def add_contact(self, user_email: str, contact_email: str, nickname: str) -> bool:
        """
        Add a contact to user's contact list
        
        Args:
            user_email: Email of the user adding the contact
            contact_email: Email of the person being added
            nickname: Custom nickname for the contact
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Check if contact already exists
            existing = self.supabase.table('contacts').select('*').eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if existing.data:
                print(f"Contact {contact_email} already exists for {user_email}")
                return False
            
            # Check if nickname is already used
            nickname_exists = self.supabase.table('contacts').select('*').eq('user_id', user_email).eq('nickname', nickname).execute()
            
            if nickname_exists.data:
                print(f"Nickname '{nickname}' already exists for {user_email}")
                return False
            
            # Add the contact
            result = self.supabase.table('contacts').insert({
                'user_id': user_email,
                'contact_email': contact_email,
                'nickname': nickname,
                'is_blocked': False
            }).execute()
            
            print(f"✅ Contact added: {nickname} ({contact_email}) for {user_email}")
            return True
            
        except Exception as e:
            print(f"❌ Error adding contact: {e}")
            return False
    
    def get_contacts(self, user_email: str, include_blocked: bool = False) -> List[Dict]:
        """
        Get all contacts for a user
        
        Args:
            user_email: Email of the user
            include_blocked: Whether to include blocked contacts
            
        Returns:
            List of contact dictionaries
        """
        try:
            query = self.supabase.table('contacts').select('*').eq('user_id', user_email)
            
            if not include_blocked:
                query = query.eq('is_blocked', False)
            
            result = query.order('nickname').execute()
            return result.data
            
        except Exception as e:
            print(f"❌ Error getting contacts: {e}")
            return []
    
    def update_nickname(self, user_email: str, contact_email: str, new_nickname: str) -> bool:
        """
        Update nickname for a contact
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact
            new_nickname: New nickname to set
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Check if new nickname is already used (excluding current contact)
            nickname_exists = self.supabase.table('contacts').select('*').eq('user_id', user_email).eq('nickname', new_nickname).neq('contact_email', contact_email).execute()
            
            if nickname_exists.data:
                print(f"Nickname '{new_nickname}' already exists for {user_email}")
                return False
            
            result = self.supabase.table('contacts').update({
                'nickname': new_nickname
            }).eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if result.data:
                print(f"✅ Nickname updated to '{new_nickname}' for {contact_email}")
                return True
            else:
                print(f"❌ Contact not found: {contact_email}")
                return False
                
        except Exception as e:
            print(f"❌ Error updating nickname: {e}")
            return False
    
    def block_contact(self, user_email: str, contact_email: str) -> bool:
        """
        Block a contact
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact to block
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            result = self.supabase.table('contacts').update({
                'is_blocked': True
            }).eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if result.data:
                print(f"🚫 Contact blocked: {contact_email}")
                return True
            else:
                print(f"❌ Contact not found: {contact_email}")
                return False
                
        except Exception as e:
            print(f"❌ Error blocking contact: {e}")
            return False
    
    def unblock_contact(self, user_email: str, contact_email: str) -> bool:
        """
        Unblock a contact
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact to unblock
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            result = self.supabase.table('contacts').update({
                'is_blocked': False
            }).eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if result.data:
                print(f"✅ Contact unblocked: {contact_email}")
                return True
            else:
                print(f"❌ Contact not found: {contact_email}")
                return False
                
        except Exception as e:
            print(f"❌ Error unblocking contact: {e}")
            return False
    
    def remove_contact(self, user_email: str, contact_email: str) -> bool:
        """
        Remove a contact completely
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact to remove
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            result = self.supabase.table('contacts').delete().eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if result.data:
                print(f"🗑️ Contact removed: {contact_email}")
                return True
            else:
                print(f"❌ Contact not found: {contact_email}")
                return False
                
        except Exception as e:
            print(f"❌ Error removing contact: {e}")
            return False
    
    def is_blocked(self, user_email: str, caller_email: str) -> bool:
        """
        Check if a caller is blocked by a user
        
        Args:
            user_email: Email of the user who might have blocked
            caller_email: Email of the person trying to call
            
        Returns:
            bool: True if blocked, False otherwise
        """
        try:
            result = self.supabase.table('contacts').select('is_blocked').eq('user_id', user_email).eq('contact_email', caller_email).execute()
            
            if result.data:
                return result.data[0]['is_blocked']
            else:
                # If no contact entry exists, not blocked
                return False
                
        except Exception as e:
            print(f"❌ Error checking block status: {e}")
            return False
    
    def get_nickname(self, user_email: str, contact_email: str) -> Optional[str]:
        """
        Get the nickname a user has assigned to a contact
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact
            
        Returns:
            str: Nickname if found, None otherwise
        """
        try:
            result = self.supabase.table('contacts').select('nickname').eq('user_id', user_email).eq('contact_email', contact_email).execute()
            
            if result.data:
                return result.data[0]['nickname']
            else:
                return None
                
        except Exception as e:
            print(f"❌ Error getting nickname: {e}")
            return None
    
    def get_conversation_history(self, user_email: str, contact_email: str, limit: int = 50) -> List[Dict]:
        """
        Get conversation history between user and contact
        
        Args:
            user_email: Email of the user
            contact_email: Email of the contact
            limit: Number of messages to retrieve (default 50)
            
        Returns:
            List of message dictionaries ordered by timestamp
        """
        try:
            # Create chat_id by sorting emails alphabetically
            emails = sorted([user_email, contact_email])
            chat_id = f"{emails[0]}_{emails[1]}"
            print(chat_id)
            
            result = self.supabase.table('messages').select('*').eq('chat_id', chat_id).order('timestamp', desc=False).limit(limit).execute()
            
            return result.data
            
        except Exception as e:
            print(f"❌ Error getting conversation history: {e}")
            return []

# Create a global instance to use in convenience functions
_contacts_manager = ContactsManager()

# Example usage and testing
def main():
    """
    Example usage of the ContactsManager
    """
    contacts = ContactsManager()
    
    print("=== Testing Contacts Manager ===\n")
    
    # Test adding contacts
    print("1. Adding contacts...")
    contacts.add_contact("john@example.com", "alice@example.com", "Alice Smith")
    contacts.add_contact("john@example.com", "bob@work.com", "Bob from Work")
    contacts.add_contact("john@example.com", "mom@family.com", "Mom")
    
    # Test getting contacts
    print("\n2. Getting John's contacts...")
    john_contacts = contacts.get_contacts("john@example.com")
    for contact in john_contacts:
        print(f"   {contact['nickname']} - {contact['contact_email']}")
    
    # Test updating nickname
    print("\n3. Updating nickname...")
    contacts.update_nickname("john@example.com", "alice@example.com", "Alice (Sister)")
    
    # Test blocking
    print("\n4. Blocking contact...")
    contacts.block_contact("john@example.com", "bob@work.com")
    
    # Test checking if blocked
    print("\n5. Checking block status...")
    is_blocked = contacts.is_blocked("john@example.com", "bob@work.com")
    print(f"   Bob is blocked: {is_blocked}")
    
    # Test getting nickname
    print("\n6. Getting nickname...")
    nickname = contacts.get_nickname("john@example.com", "mom@family.com")
    print(f"   Nickname for mom@family.com: {nickname}")

    convo_history = contacts.get_conversation_history("optimistic.sukanth@gmail.com", "ontelligency@gmail.com")
    print(convo_history)

# Convenience functions (as requested)
def add_friend(user_email: str, friend_email: str, friend_nickname: str) -> bool:
    """
    Simple function to add a friend/contact
    """
    return _contacts_manager.add_contact(user_email, friend_email, friend_nickname)

def get_friends(user_email: str) -> List[Dict]:
    """
    Simple function to get all friends/contacts
    """
    return _contacts_manager.get_contacts(user_email)

def block_friend(user_email: str, friend_email: str) -> bool:
    """
    Simple function to block a friend/contact
    """
    return _contacts_manager.block_contact(user_email, friend_email)

def unblock_friend(user_email: str, friend_email: str) -> bool:
    """
    Simple function to unblock a friend/contact
    """
    return _contacts_manager.unblock_contact(user_email, friend_email)

def get_nickname(user_email: str, contact_email: str) -> Optional[str]:
    """
    Simple function to get a contact's nickname
    """
    return _contacts_manager.get_nickname(user_email, contact_email)

def is_blocked(user_email: str, caller_email: str) -> bool:
    """
    Simple function to check if someone is blocked
    """
    return _contacts_manager.is_blocked(user_email, caller_email)

if __name__ == "__main__":
    main()