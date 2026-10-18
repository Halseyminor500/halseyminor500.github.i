#!/usr/bin/env python3
"""The morning refresh for halseyminor.com. Writes the day's counts (data-since), each deadline's state (data-due) and the
"Counts as of" date into index.html, and the date into sitemap.xml, by the same rules as the page's own script.
The record itself (answers, new items) changes only in the full build (build.py), never here.

    python3 refresh.py [YYYY-MM-DD]     # default: today, Pacific time

build.py uses the same rules (refresh() below), so the build and the morning refresh cannot disagree."""
import datetime, pathlib, re, sys, zoneinfo


def long(d):
    return '%s %d, %d' % (d.strftime('%B'), d.day, d.year)


def chip(a, today):
    """A request is due, due today, then overdue; a time limit (data-kind="limit") has days left, a last day, then has
    passed; a window (data-end) is "ending now" from its first day to its last; an answer (data-met) ends it. A reply not
    yet weighed (data-replied) says so; a reply that does not give what the law requires (data-fail) is a Fail."""
    if a.get('data-fail'):
        return 'chip fail', 'Fail'
    if a.get('data-met'):
        return 'chip met', 'Answered ' + a['data-met']
    if a.get('data-replied'):
        return 'chip', 'Replied ' + a['data-replied']
    due = datetime.date.fromisoformat(a['data-due']); n = (due - today).days
    if a.get('data-kind') == 'limit':
        end = datetime.date.fromisoformat(a.get('data-end', a['data-due'])); m = (end - today).days
        if n > 1: return 'chip', '%d days left' % n
        if n == 1: return 'chip', '1 day left'
        if m >= 0: return 'chip today', 'Last day' if end == due else 'Ending now'
        return 'chip over', 'Passed'
    if n > 1: return 'chip', 'Due in %d days' % n
    if n == 1: return 'chip', 'Due tomorrow'
    if n == 0: return 'chip today', 'Due today'
    return 'chip over', 'Overdue %d %s' % (-n, 'day' if n == -1 else 'days')


def refresh(page, today):
    """The page with its counts, deadline states and "as of" date set for today."""
    page = re.sub(r'(<[^>]*\bdata-since="(\d{4}-\d\d-\d\d)"[^>]*>)[^<]*(<)',
                  lambda m: m.group(1) + str((today - datetime.date.fromisoformat(m.group(2))).days) + m.group(3), page)
    def fill(m):
        cls, txt = chip(dict(re.findall(r'(data-[\w-]+)="([^"]*)"', m.group(1))), today)
        return m.group(1) + m.group(2) + '<span class="%s">%s</span>' % (cls, txt)
    page = re.sub(r'(<li [^>]*\bdata-due="[^"]*"[^>]*>)(.*?)<span class="chip[^"]*">[^<]*</span>', fill, page, flags=re.S)
    return re.sub(r'(<span id="asof">)[^<]*(</span>)', lambda m: m.group(1) + long(today) + m.group(2), page)


if __name__ == '__main__':
    HERE = pathlib.Path(__file__).resolve().parent
    today = (datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1
             else datetime.datetime.now(zoneinfo.ZoneInfo('America/Los_Angeles')).date())
    changed = []
    index = HERE / 'index.html'
    old = index.read_text(encoding='utf-8'); new = refresh(old, today)
    if new != old:
        index.write_text(new, encoding='utf-8'); changed.append('index.html')
    sitemap = HERE / 'sitemap.xml'
    if sitemap.exists():
        old = sitemap.read_text(encoding='utf-8')
        new = re.sub(r'<lastmod>[^<]*</lastmod>', '<lastmod>%s</lastmod>' % today.isoformat(), old)
        if new != old:
            sitemap.write_text(new, encoding='utf-8'); changed.append('sitemap.xml')
    with open(HERE / 'refresh-log.txt', 'a', encoding='utf-8') as log:
        log.write('%s · counts as of %s · %s\n' % (today.isoformat(), long(today), ', '.join(changed) or 'already current'))
    print('counts as of', long(today), '·', ', '.join(changed) or 'already current')
