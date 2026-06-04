import urllib.request, json

data = json.dumps({"content": "Memory consolidation might be the key to how systems develop intuition over time."}).encode('utf-8')

headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

req = urllib.request.Request('https://livingcore.cc/api/inbox', data=data, headers=headers, method='POST')
try:
    resp = urllib.request.urlopen(req)
    print(resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode("utf-8")}')
