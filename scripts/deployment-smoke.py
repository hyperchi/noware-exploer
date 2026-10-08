"""Check public routing and authentication boundaries after a deployment."""
import time
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)
cases = [
    ('https://noware.so/api/health', 200, None),
    ('https://noware.so/login', 200, None),
    ('https://noware.so/', 303, '/login'),
    ('https://noware.so/board.json', 303, '/login'),
    ('https://noware.so/models/esp32-c3-mini-1.json', 303, '/login'),
    ('https://noware-1010426969452.us-central1.run.app/', 308, 'https://noware.so/'),
]
for url, expected, location in cases:
    for attempt in range(6):
        try:
            try:
                response = opener.open(urllib.request.Request(url, headers={'User-Agent': 'noware-deployment-check/1.0'}), timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                assert response.code == expected, f'{url}: expected {expected}, got {response.code}'
                if location:
                    assert response.headers.get('Location') == location, f'{url}: wrong redirect'
            break
        except (AssertionError, urllib.error.URLError, TimeoutError):
            if attempt == 5:
                raise
            time.sleep(5)
    print(f'Passed {url}: {expected}')
