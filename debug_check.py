import json
d = json.load(open('debug_dialogue.json'))
for t in d['data']:
    print(f'=== {t["speaker"].upper()} (turn {t["turn_number"]}) ===')
    print(t['content'][:500])
    print()
