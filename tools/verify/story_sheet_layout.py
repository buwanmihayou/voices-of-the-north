"""Story sheet layout regression: bounded expansion and isolated inner scrolling.

Run after building: python -X utf8 tools/verify/story_sheet_layout.py
Use --probe for pre-fix geometry and temporary screenshots, --screenshots for QA.
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import ROOT, frontend_server, launch_browser, warn_if_stale

SIZES = [(390, 844), (375, 667), (320, 568), (1280, 900)]
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def settle(page):
    page.wait_for_function("""() => {
      const sheet = document.getElementById('storySheet');
      return sheet.classList.contains('is-open') &&
        sheet.getAnimations().every(a => a.playState !== 'running');
    }""")


def geometry(page):
    return page.evaluate("""() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
      };
      const hit = selector => {
        const node = document.querySelector(selector), r = node.getBoundingClientRect();
        const at = document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        return !!at && (at === node || node.contains(at));
      };
      const body = document.getElementById('storySheetBody');
      return {
        viewport:[innerWidth,innerHeight], expanded:VTN.sheet.isExpanded(),
        sheet:rect('#storySheet'), page:rect('.page--stories'), shell:rect('#appShell'),
        topbar:rect('.topbar'), grab:rect('#sheetGrab'), close:rect('#sheetClose'),
        body:rect('#storySheetBody'), hero:rect('.sheet-hero'), nav:rect('.bottom-nav'),
        closeReachable:hit('#sheetClose'), grabReachable:hit('#sheetGrab'),
        scroll: {inner:body.scrollTop, max:body.scrollHeight-body.clientHeight,
          page:document.querySelector('.page--stories').scrollTop,
          shell:document.getElementById('appShell').scrollTop,
          document:document.scrollingElement.scrollTop,
          list:document.getElementById('atlasList').scrollTop}
      };
    }""")


def open_story(browser, base, width, height, touch=False, errors=None):
    page = browser.new_page(viewport={"width":width,"height":height},has_touch=touch,is_mobile=touch)
    if errors is not None:
        page.on('pageerror',lambda error:errors.append(str(error)))
    origin = base.split('/voices-')[0]
    page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(origin) else r.abort())
    page.add_init_script("localStorage.setItem('vtn.v2.onboarded','1')")
    page.goto(base+'#stories', wait_until='domcontentloaded')
    page.wait_for_function('window.VTN_READY === true')
    page.locator('#atlasViewBtn').click()
    page.locator('#story-YL-001 .story-item__main').click()
    settle(page)
    return page


def drag_grab(page, dy):
    grab = page.locator('#sheetGrab').bounding_box()
    x, y = grab['x']+grab['width']/2, grab['y']+grab['height']/2
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x,max(1,y+dy),steps=12)
    page.mouse.up()
    settle(page)


def scroll_body(page,direction):
    body = page.locator('#storySheetBody').bounding_box()
    page.mouse.move(body['x']+body['width']/2,body['y']+min(body['height']-10,80))
    page.mouse.wheel(0,direction*100000)


def scroll_to_bottom(page):
    scroll_body(page,1)
    page.wait_for_function("""() => {
      const body = document.getElementById('storySheetBody');
      return body.scrollTop > 0 && body.scrollHeight-body.clientHeight-body.scrollTop < 2;
    }""")


def touch_scroll_smoke(browser,base,errors):
    page = open_story(browser,base,390,844,touch=True,errors=errors)
    drag_grab(page,-180)
    before = geometry(page)
    body = before['body']
    x,y = body['left']+body['width']/2,body['top']+min(250,body['height']/2)
    session = page.context.new_cdp_session(page)
    session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y,'id':0}]})
    for step in range(1,15):
        session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-step*10,'id':0}]})
        time.sleep(.025)
    session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    page.wait_for_function('document.getElementById(\'storySheetBody\').scrollTop > 0',timeout=5000)
    after = geometry(page)
    check('mobile native touch scroll moves sheet body',after['scroll']['inner']>0,after)
    check('mobile native touch scroll leaves outer containers unchanged',all(after['scroll'][key]==before['scroll'][key]
          for key in ('page','shell','document','list')),after)
    check('mobile native touch scroll keeps sheet expanded and controls reachable',after['expanded'] and
          after['closeReachable'] and after['grabReachable'],after)
    session.detach()
    page.close()


def main():
    warn_if_stale()
    probe = '--probe' in sys.argv
    output = Path(tempfile.mkdtemp(prefix='vtn-sheet-before-')) if probe else ROOT/'docs/audit/2026-11-11'
    if probe or '--screenshots' in sys.argv:
        output.mkdir(parents=True,exist_ok=True)
    with frontend_server() as base, sync_playwright() as playwright:
        browser = launch_browser(playwright)
        errors = []
        try:
            for width,height in SIZES:
                page = open_story(browser,base,width,height,errors=errors)
                initial = geometry(page)
                if not probe:
                    page.locator('#sheetGrab').click()
                    settle(page)
                    check(f'{width} grab click expands sheet',page.evaluate('VTN.sheet.isExpanded()'))
                    page.locator('#sheetGrab').click()
                    settle(page)
                    check(f'{width} grab click returns to half-open',not page.evaluate('VTN.sheet.isExpanded()'))
                drag_grab(page,-180)
                full = geometry(page)
                if probe or '--screenshots' in sys.argv:
                    page.screenshot(path=str(output/f'story-sheet-full-{width}.png'))
                if not probe:
                    check(f'{width} pointer expands sheet',full['expanded'])
                    check(f'{width} expanded sheet starts below topbar',full['sheet']['top'] >= full['topbar']['bottom']-1,full)
                    check(f'{width} first content remains below topbar',full['hero']['top'] >= full['topbar']['bottom']-1,full)
                    check(f'{width} controls stay within content bounds',
                          full['close']['top'] >= full['page']['top'] and full['grab']['top'] >= full['page']['top']-1,full)
                    check(f'{width} close and grab reachable at top',full['closeReachable'] and full['grabReachable'],full)
                    exposed = initial['page']['bottom']-initial['sheet']['top']
                    expected = min(height*.55,initial['page']['height'])
                    check(f'{width} half-open exposure preserved',abs(exposed-expected)<3,initial)
                    check(f'{width} sheet fits horizontal phone frame',full['sheet']['left'] >= full['shell']['left']-1 and
                          full['sheet']['right'] <= full['shell']['right']+1,full)
                scroll_to_bottom(page)
                bottom = geometry(page)
                if probe or '--screenshots' in sys.argv:
                    page.screenshot(path=str(output/f'story-sheet-scrolled-{width}.png'))
                if probe:
                    print(json.dumps({'size':[width,height],'half':initial,'full':full,'scrolled':bottom},ensure_ascii=False),flush=True)
                else:
                    check(f'{width} actual wheel scrolls sheet body',bottom['scroll']['inner']>0 and
                          bottom['scroll']['max']-bottom['scroll']['inner']<2,bottom)
                    check(f'{width} outer app containers do not scroll',all(bottom['scroll'][key]==full['scroll'][key]
                          for key in ('page','shell','document','list')),bottom)
                    check(f'{width} sheet stays below topbar after inner scroll',bottom['sheet']['top']>=bottom['topbar']['bottom']-1,bottom)
                    check(f'{width} close and grab reachable at max scroll',bottom['closeReachable'] and bottom['grabReachable'],bottom)
                    scroll_body(page,-1)
                    page.wait_for_function('document.getElementById(\'storySheetBody\').scrollTop === 0')
                    returned = geometry(page)
                    check(f'{width} scroll returns first content to visible top while expanded',returned['expanded'] and
                          abs(returned['hero']['top']-full['hero']['top'])<1 and
                          returned['hero']['top']>=returned['topbar']['bottom']-1,returned)
                    drag_grab(page,110)
                    check(f'{width} downward drag returns to half-open',not page.evaluate('VTN.sheet.isExpanded()'))
                    page.locator('#sheetClose').click()
                    page.wait_for_function('!VTN.sheet.isOpen() && document.getElementById(\'storySheet\').hidden')
                    check(f'{width} close button closes sheet',page.locator('#storySheet').is_hidden())
                page.close()
            if not probe:
                touch_scroll_smoke(browser,base,errors)
                check('no frontend runtime errors',not errors,errors)
        finally:
            browser.close()
    if probe or '--screenshots' in sys.argv:
        print(f'Screenshots: {output}',flush=True)
    if not probe:
        print(f'ALL PASSED: {CHECKS} checks',flush=True)


if __name__ == '__main__':
    main()
