import http.server, socketserver

LOG = '/tmp/opencode/backend.log'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/log':
            length = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(length).decode('utf-8', 'replace')
            with open(LOG, 'a') as f:
                f.write(data + '\n=====\n')
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *a):
        pass

with socketserver.TCPServer(('0.0.0.0', 8080), Handler) as httpd:
    print('serving on 0.0.0.0:8080 (static + POST /log)')
    httpd.serve_forever()
