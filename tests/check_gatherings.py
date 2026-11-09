"""Static privacy/contract checks; no real RSVP data or service connections."""
from pathlib import Path
from html.parser import HTMLParser
import unittest
from datetime import datetime
ROOT = Path(__file__).resolve().parents[1]
class Nodes(HTMLParser):
    def __init__(self):
        super().__init__(); self.nodes=[]
    def handle_starttag(self, tag, attrs): self.nodes.append((tag,dict(attrs)))
class GatheringsChecks(unittest.TestCase):
    def setUp(self):
        self.html=(ROOT/'events.html').read_text(); self.dom=Nodes(); self.dom.feed(self.html)
    def test_exact_dates(self):
        dates=[a['datetime'] for t,a in self.dom.nodes if t=='time']
        self.assertEqual(dates,['2026-11-20T17:30:00-07:00','2026-12-19T17:30:00-07:00'])
        self.assertEqual([datetime.fromisoformat(d).strftime('%A') for d in dates],['Friday','Saturday'])
    def test_form_is_fail_closed(self):
        forms=[a for t,a in self.dom.nodes if t=='form'];self.assertEqual(len(forms),1)
        self.assertNotIn('action',forms[0]);self.assertNotIn('method',forms[0])
        self.assertTrue(any(t=='fieldset' and 'disabled' in a for t,a in self.dom.nodes))
        self.assertTrue(any(t=='meta' and a.get('content')=="form-action 'none'" for t,a in self.dom.nodes))
        for tag,attrs in self.dom.nodes:
            if tag in ('input','select','textarea'):
                self.assertNotIn('name',attrs)
            if tag=='button': self.assertEqual(attrs.get('type'),'button');self.assertIn('disabled',attrs)
        self.assertNotIn('<script',self.html)
    def test_labels_and_fields(self):
        labels={a['for'] for t,a in self.dom.nodes if t=='label'}
        fields={a['id']:a for t,a in self.dom.nodes if t in ('input','select','textarea')}
        self.assertEqual(set(fields),labels)
        self.assertEqual(fields['adult-email']['type'],'email')
        self.assertEqual(fields['guest-count']['min'],'1')
        self.assertNotIn('required',fields['request-message'])
    def test_no_private_location_fields(self):
        for token in ('streetAddress','postalCode','latitude','longitude','mailto:?','formspree.io/f/'):
            self.assertNotIn(token,self.html)
        self.assertNotIn('address', ' '.join(a.get('id','') for t,a in self.dom.nodes if t=='input'))
    def test_verified_flyer(self):
        self.assertTrue((ROOT/'assets/poker-night-2026.png').is_file())
        self.assertIn('width="1254" height="1254"',self.html)
if __name__=='__main__': unittest.main(verbosity=2)
