import http.server
import json
import os
import sys

PORT = int(os.environ.get('PORT', 57568))

DATA_DIR = 'data'
if not os.path.exists(DATA_DIR):
    try:
        os.makedirs(DATA_DIR)
    except Exception as e:
        print(f"Error creating data directory: {e}")

LEADERBOARD_FILE = os.path.join(DATA_DIR, 'leaderboard.json')
OLD_LEADERBOARD_FILE = 'leaderboard.json'

# Migrate old leaderboard if it exists in root
if os.path.exists(OLD_LEADERBOARD_FILE) and OLD_LEADERBOARD_FILE != LEADERBOARD_FILE:
    try:
        import shutil
        # Only migrate if target doesn't exist yet
        if not os.path.exists(LEADERBOARD_FILE):
            shutil.move(OLD_LEADERBOARD_FILE, LEADERBOARD_FILE)
            print(f"Migrated leaderboard from {OLD_LEADERBOARD_FILE} to {LEADERBOARD_FILE}")
        else:
            os.remove(OLD_LEADERBOARD_FILE)
    except Exception as e:
        print(f"Error migrating leaderboard: {e}")

# Seed empty leaderboard if missing
if not os.path.exists(LEADERBOARD_FILE):
    try:
        with open(LEADERBOARD_FILE, 'w') as f:
            json.dump([], f)
    except Exception as e:
        print(f"Error seeding leaderboard: {e}")

class GameRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add headers to avoid browser caching of API requests
        if self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        # Handle preflight requests
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/leaderboard':
            try:
                if os.path.exists(LEADERBOARD_FILE):
                    with open(LEADERBOARD_FILE, 'r') as f:
                        data = json.load(f)
                else:
                    data = []
            except Exception as e:
                print(f"Error reading leaderboard: {e}")
                data = []
            
            response_bytes = json.dumps(data).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response_bytes)))
            self.end_headers()
            self.wfile.write(response_bytes)
        else:
            # Fallback to serving static files
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/score':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                new_entry = json.loads(post_data.decode('utf-8'))
                
                name = str(new_entry.get('name', 'PILOT')).strip().upper()[:25]
                if not name:
                    name = 'PILOT'
                score = int(new_entry.get('score', 0))
                difficulty = str(new_entry.get('difficulty', 'medium'))

                # Read current board
                board = []
                if os.path.exists(LEADERBOARD_FILE):
                    with open(LEADERBOARD_FILE, 'r') as f:
                        board = json.load(f)
                
                # Deduplicate: find if same name already has a score
                existing_entry = None
                for entry in board:
                    if entry.get('name') == name:
                        existing_entry = entry
                        break
                
                if existing_entry:
                    if score > existing_entry.get('score', 0):
                        existing_entry['score'] = score
                        existing_entry['difficulty'] = difficulty
                else:
                    board.append({"name": name, "score": score, "difficulty": difficulty})
                
                # Sort descending
                board.sort(key=lambda x: x.get('score', 0), reverse=True)
                
                # Save (no limit)
                with open(LEADERBOARD_FILE, 'w') as f:
                    json.dump(board, f)

                response_bytes = json.dumps(board).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)
            except Exception as e:
                print(f"Error processing score submission: {e}")
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run():
    # Bind to 0.0.0.0 so external machines can connect
    server_address = ('0.0.0.0', PORT)
    try:
        httpd = http.server.HTTPServer(server_address, GameRequestHandler)
        print(f"Server successfully started at http://localhost:{PORT}")
        print(f"LAN Address: http://0.0.0.0:{PORT}")
        sys.stdout.flush() # flush to ensure it is printed in the log immediately
        httpd.serve_forever()
    except Exception as e:
        print(f"Failed to start server: {e}")
        sys.exit(1)

if __name__ == '__main__':
    run()
