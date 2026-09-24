import sys, collections
import pandas as pd
sys.path.insert(0, 'tools')
from brain_client import Brain
n = pd.read_feather('data/brain/neurons.feather')
b = Brain(); b.param('w_syn', 0.15)
b.clear(); b.reset()
b.drive('pr_L', 9); b.drive('pr_R', 9); b.advance(300)
b.drive('looming_R', 12); b.advance(200); b.drive('looming_R', 0); b.advance(500)
# collect who fires during the persistent state
cnt = collections.Counter()
for _ in range(40):
    b.advance(20)
    parts = b._cmd('spikes').split()
    for i in map(int, parts[2:]): cnt[i] += 1
ids = list(cnt)
sub = n.iloc[ids].copy(); sub['spikes'] = [cnt[i] for i in ids]
print('neurons firing in persistent state:', len(ids), ' total spikes:', sum(cnt.values()))
print(sub.groupby(['superclass', 'subclass', 'type'], dropna=False).agg(neurons=('spikes', 'size'), spikes=('spikes', 'sum')).sort_values('spikes', ascending=False).head(25).to_string())
b.close()
