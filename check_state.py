import json
d = json.load(open('debug_state.json')).get('data', {})
print('=== CURRENT STATE ===')
print('Packets:', len(d.get('packets', [])))
print('Turns:', d.get('dialogue_turns', 0))
print('Coherence:', d.get('system_state', {}).get('avg_coherence', '?'))
cats = d.get('categories', [])
print('Categories:', len(cats))
for c in cats[:7]:
    print(' ', c['icon'], c['name'], '(' + c['id'] + ')')
pkts = d.get('packets', [])
pcts = sum(1 for p in pkts if p.get('primary_category'))
print('Categorized:', pcts, '/', len(pkts))
