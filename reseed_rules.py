import json, urllib.request

# Check the specific rule endpoint
req = urllib.request.Request('https://livingcore.cc/api/rules/thinking_rules')
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f'GET error: {e}')
