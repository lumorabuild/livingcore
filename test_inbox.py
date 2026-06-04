import json, urllib.request

data = json.dumps({
    "content": "The connection between memory consolidation and creativity feels underexplored. What if we store not just ideas but the emotional weight attached to them?"
}).encode('utf-8')

req = urllib.request.Request(
    'https://livingcore.lumorabuild.workers.dev/api/inbox',
    data=data,
    headers={'Content-Type': 'application/json'}
)

resp = urllib.request.urlopen(req)
print(resp.read().decode('utf-8'))
