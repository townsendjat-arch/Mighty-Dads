"""Dependency-free smoke checks: run `python tests/check_site.py` from any directory."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import unittest

ROOT = Path(__file__).resolve().parents[1]
NAV = ['events.html', 'dad-groups.html', 'resources.html', 'newsletter.html', 'about.html']


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path, self.nodes, self.navigation = path, [], []
        self.in_nav = False
        self.blocks, self.block_stack = [], []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.nodes.append((tag, attrs))
        if tag in ['section', 'article'] or (tag == 'div' and 'card-grid' in attrs.get('class', '').split()):
            block = {'tag': tag, 'attrs': attrs, 'text': ''}
            self.blocks.append(block)
            self.block_stack.append(block)
        elif self.block_stack and tag == 'div':
            self.block_stack.append({'tag': tag, 'attrs': attrs, 'text': ''})
        if tag == 'nav' and attrs.get('class') == 'site-nav':
            self.in_nav = True
        elif tag == 'a' and self.in_nav:
            self.navigation.append(attrs)

    def handle_data(self, data):
        for block in self.block_stack:
            block['text'] += data

    def handle_endtag(self, tag):
        if self.block_stack and self.block_stack[-1]['tag'] == tag:
            self.block_stack.pop()
        if tag == 'nav':
            self.in_nav = False


PAGES = {p.name: Page(p) for p in ROOT.glob('*.html')}


class SiteChecks(unittest.TestCase):
    def test_navigation_and_page_basics(self):
        for name, page in PAGES.items():
            with self.subTest(page=name):
                self.assertEqual([a['href'] for a in page.navigation], NAV)
                self.assertEqual(sum(t == 'h1' for t, a in page.nodes), 1)
                main = [a for t, a in page.nodes if t == 'main']
                self.assertEqual(len(main), 1)
                self.assertEqual(main[0].get('id'), 'main-content')
                self.assertEqual(main[0].get('tabindex'), '-1')
                self.assertTrue(any(a.get('href') == '#main-content' for t, a in page.nodes if t == 'a'))
                self.assertTrue(any(a.get('name') == 'description' and a.get('content') for t, a in page.nodes if t == 'meta'))
                canonical = [a['href'] for t, a in page.nodes if t == 'link' and a.get('rel') == 'canonical']
                self.assertEqual(canonical, ['https://www.mightydads.org/' + ('' if name == 'index.html' else name)])
                current = [a['href'] for a in page.navigation if a.get('aria-current') == 'page']
                self.assertEqual(current, [] if name == 'index.html' else [name])
                ids = [a['id'] for t, a in page.nodes if 'id' in a]
                self.assertEqual(len(ids), len(set(ids)))

    def test_local_links_assets_and_external_link_safety(self):
        for name, page in PAGES.items():
            for tag, attrs in page.nodes:
                with self.subTest(page=name, element=tag, attrs=attrs):
                    if tag == 'img':
                        self.assertIn('alt', attrs)
                        self.assertIn('width', attrs)
                        self.assertIn('height', attrs)
                    if attrs.get('target') == '_blank':
                        self.assertIn('noopener', attrs.get('rel', '').split())
                    for key in ['href', 'src']:
                        if key not in attrs:
                            continue
                        value = attrs[key]
                        self.assertNotIn(value, ['', '#'])
                        url = urlsplit(value)
                        if url.scheme or url.netloc:
                            continue
                        target = ROOT / unquote(url.path) if url.path else page.path
                        self.assertTrue(target.is_file(), str(target))
                        if url.fragment and target.suffix == '.html':
                            ids = [a.get('id') for t, a in PAGES[target.name].nodes]
                            self.assertIn(unquote(url.fragment), ids)

    def test_contact_and_newsletter_are_separate(self):
        for name in ['events.html', 'dad-groups.html']:
            with self.subTest(page=name):
                links = [a.get('href') for t, a in PAGES[name].nodes if t == 'a']
                self.assertEqual(links.count('mailto:jason@mightydads.org'), 1)
                self.assertIn('newsletter.html', links)
                self.assertIn('https://mightydads.beehiiv.com/subscribe', links)
                self.assertIn('>Contact Jason</a>', PAGES[name].path.read_text())

    def test_accessibility_structure_and_nonempty_sections(self):
        for name, page in PAGES.items():
            with self.subTest(page=name):
                self.assertTrue(any(t == 'html' and a.get('lang') == 'en' for t, a in page.nodes))
                self.assertTrue(any(t == 'nav' and a.get('aria-label') for t, a in page.nodes))
                previous_level = 0
                for tag, attrs in page.nodes:
                    if tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                        level = int(tag[1])
                        self.assertLessEqual(level, previous_level + 1, f'{name}: heading skips to {tag}')
                        previous_level = level
                for block in page.blocks:
                    self.assertTrue(block['text'].strip(), f'{name}: empty {block["tag"]} {block["attrs"]}')

    def test_unverified_circle_of_fathers_is_not_linked(self):
        links = [a.get('href', '') for t, a in PAGES['resources.html'].nodes if t == 'a']
        self.assertFalse(any('parentsthrive.org' in link for link in links))

    def test_stale_promises_are_removed(self):
        for page in PAGES.values():
            self.assertNotIn('weekly', page.path.read_text().lower())
        events = PAGES['events.html'].path.read_text()
        self.assertNotIn('June 13, 2026', events)
        self.assertNotIn('Every Tuesday This Summer', events)
        self.assertNotIn('Saturday Mornings', events)
        self.assertNotIn('No current Mighty Dads events are listed here.', events)
        self.assertIn('Mighty Dads Gatherings', events)
        self.assertIn('Poker Night', events)
        self.assertIn('Christmas Party', events)


if __name__ == '__main__':
    unittest.main(verbosity=2)
