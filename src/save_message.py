import sys
import sqlite3
from datetime import datetime

def save_message(chat_id, user_id, message):
    conn = sqlite3.connect('chat_history.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT,
            user_id TEXT,
            message TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute(
        'INSERT INTO messages (chat_id, user_id, message) VALUES (?, ?, ?)',
        (chat_id, user_id, message)
    )
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    save_message(sys.argv[1], sys.argv[2], sys.argv[3])