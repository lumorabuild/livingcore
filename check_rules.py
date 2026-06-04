import json
d = json.load(open('debug_rules.json'))
for r in d.get('data', []):
    pc = r.get('parsed_content', {})
    print('Rule:', r['name'], 'v' + str(r['version']))
    print('  Description:', pc.get('description', '')[:80])
    print('  Sections:', list(pc.keys())[:8])
    print()
