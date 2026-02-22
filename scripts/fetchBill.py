#!/usr/bin/env python3
"""
fetchBill.py — Fetch utility bill using undetected-chromedriver.

Uses Selenium with undetected-chromedriver in NON-HEADLESS mode to bypass
even the most aggressive bot detection (Rogers RC01, etc.).

Environment-aware:
  - Windows/Mac (local): Opens a real Chrome window (positioned off-screen)
  - Linux cloud (no display): Auto-starts Xvfb virtual framebuffer so Chrome
    still runs "non-headless" but renders to a virtual screen. Bot detectors
    see a real browser, not a headless one.

Credentials are passed via stdin as JSON for security.

Usage:
    echo '{"username":"x","password":"y"}' | python scripts/fetchBill.py --url <url> --stdin

Cloud deployment requirements (Linux):
    apt-get install -y xvfb chromium-browser  (or google-chrome-stable)
    pip install undetected-chromedriver selenium PyVirtualDisplay
"""

import argparse
import base64
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time
import random
import traceback
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)


# ── Human-like helpers ───────────────────────────────────────

# Speed multiplier for all delays (lower = faster, 1.0 = original)
_DELAY_MULT = 0.4

def random_delay(min_s=1.0, max_s=3.0):
    time.sleep((min_s + random.random() * (max_s - min_s)) * _DELAY_MULT)


def human_type(element, text, min_delay=0.04, max_delay=0.12):
    """Type character by character with variable cadence."""
    for i, char in enumerate(text):
        element.send_keys(char)
        # Occasionally pause longer (like a human thinking)
        if random.random() < 0.08:
            time.sleep(0.3 + random.random() * 0.4)
        else:
            time.sleep(min_delay + random.random() * (max_delay - min_delay))


def _js_set_value(driver, element, text):
    """Set input value via JavaScript and dispatch events — works for Angular/React/ASP.NET forms."""
    driver.execute_script("""
        var el = arguments[0];
        var val = arguments[1];
        // Focus the element first (important for ASP.NET validators)
        el.focus();
        // Use native setter to bypass framework wrappers
        var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        );
        if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(el, val);
        } else {
            el.value = val;
        }
        // Dispatch comprehensive events for all frameworks
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        // Angular-specific: ngModel listens on 'input' and 'compositionend'
        el.dispatchEvent(new Event('compositionend', { bubbles: true }));
        // ASP.NET: blur triggers validation + ensures value is committed
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    """, element, text)


def robust_type(driver, element, text, dbg_fn=None):
    """Type into an element with verification. Falls back to JS if send_keys fails.
    Returns True if the field was successfully filled."""
    label = ""
    try:
        label = element.get_attribute("name") or element.get_attribute("id") or element.get_attribute("type") or "?"
    except Exception:
        pass

    # Strategy 1: Click + clear + human_type (send_keys char by char)
    try:
        human_click(driver, element)
        time.sleep(0.3)
        element.clear()
        time.sleep(0.2)
        human_type(element, text)
        time.sleep(0.5)
    except Exception as e:
        if dbg_fn:
            dbg_fn(f"  human_type failed for [{label}]: {e}")

    # Check if value was set
    current = ""
    try:
        current = element.get_attribute("value") or ""
    except Exception:
        pass

    if current == text:
        if dbg_fn:
            dbg_fn(f"  Field [{label}] filled OK via send_keys (len={len(current)})")
        return True

    if dbg_fn:
        dbg_fn(f"  Field [{label}] has value '{current[:20]}...' (expected len={len(text)}) — trying JS fallback")

    # Strategy 2: JavaScript native setter + event dispatch
    try:
        element.clear()
        time.sleep(0.2)
        _js_set_value(driver, element, text)
        time.sleep(0.5)
    except Exception as e:
        if dbg_fn:
            dbg_fn(f"  JS setValue failed for [{label}]: {e}")

    # Verify again
    try:
        current = element.get_attribute("value") or ""
    except Exception:
        current = ""

    if current == text:
        if dbg_fn:
            dbg_fn(f"  Field [{label}] filled OK via JS fallback (len={len(current)})")
        return True

    # Strategy 3: Select all + delete + type slowly
    if dbg_fn:
        dbg_fn(f"  Field [{label}] still '{current[:20]}...' — trying select-all + retype")
    try:
        from selenium.webdriver.common.keys import Keys
        element.click()
        time.sleep(0.2)
        element.send_keys(Keys.CONTROL + "a")
        time.sleep(0.1)
        element.send_keys(Keys.DELETE)
        time.sleep(0.2)
        element.send_keys(text)
        time.sleep(0.5)
    except Exception as e:
        if dbg_fn:
            dbg_fn(f"  Select-all retype failed: {e}")

    try:
        current = element.get_attribute("value") or ""
    except Exception:
        current = ""

    if current == text:
        if dbg_fn:
            dbg_fn(f"  Field [{label}] filled OK via select-all retype (len={len(current)})")
        return True

    if dbg_fn:
        dbg_fn(f"  WARNING: Field [{label}] may not be filled correctly (got '{current[:30]}', wanted len={len(text)})")
    return len(current) > 0  # Partial success if something was typed


def human_click(driver, element):
    """Click an element using ActionChains with a slight offset (not dead-center).
    Falls back to JS click if ActionChains fails."""
    from selenium.webdriver.common.action_chains import ActionChains
    size = element.size
    # Random offset within the element — humans never click exact center
    x_off = random.randint(-max(1, size["width"] // 4), max(1, size["width"] // 4))
    y_off = random.randint(-max(1, size["height"] // 4), max(1, size["height"] // 4))
    try:
        ac = ActionChains(driver)
        ac.move_to_element_with_offset(element, x_off, y_off)
        ac.pause(0.1 + random.random() * 0.2)
        ac.click()
        ac.perform()
    except Exception:
        # Fallback: JS click (triggers jQuery/addEventListener handlers too)
        try:
            driver.execute_script("arguments[0].click()", element)
        except Exception:
            element.click()


def random_mouse_wander(driver, steps=3):
    """Move the mouse randomly around the page to look human."""
    from selenium.webdriver.common.action_chains import ActionChains
    try:
        ac = ActionChains(driver)
        for _ in range(steps):
            ac.move_by_offset(
                random.randint(-50, 50),
                random.randint(-50, 50),
            )
            ac.pause(0.2 + random.random() * 0.5)
        ac.perform()
    except Exception:
        pass


def random_scroll(driver):
    """Small random scroll to mimic reading."""
    try:
        dist = random.randint(50, 250) * random.choice([1, -1])
        driver.execute_script(f"window.scrollBy(0, {dist});")
    except Exception:
        pass


# ── Main ─────────────────────────────────────────────────────

def _is_display_available():
    """Check if a real display is available (Windows/Mac always True, Linux checks $DISPLAY)."""
    if platform.system() != "Linux":
        return True  # Windows/Mac always have a display
    return bool(os.environ.get("DISPLAY"))


def _start_virtual_display(debug=False):
    """Start Xvfb virtual framebuffer on Linux cloud servers (no-op on Windows/Mac).
    Returns a display object to stop later, or None."""
    if platform.system() != "Linux":
        return None
    if _is_display_available():
        if debug:
            print("[fetchBill] Linux with existing DISPLAY, skipping Xvfb", file=sys.stderr)
        return None

    # Try PyVirtualDisplay first (cleaner API)
    try:
        from pyvirtualdisplay import Display
        vdisplay = Display(visible=False, size=(1280, 900))
        vdisplay.start()
        if debug:
            print(f"[fetchBill] Started PyVirtualDisplay on :{vdisplay.display}", file=sys.stderr)
        return vdisplay
    except ImportError:
        pass

    # Fallback: start Xvfb manually
    try:
        display_num = random.randint(99, 999)
        env_display = f":{display_num}"
        proc = subprocess.Popen(
            ["Xvfb", env_display, "-screen", "0", "1280x900x24", "-ac"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1)
        os.environ["DISPLAY"] = env_display
        if debug:
            print(f"[fetchBill] Started Xvfb on {env_display} (pid={proc.pid})", file=sys.stderr)
        return proc
    except FileNotFoundError:
        if debug:
            print("[fetchBill] WARNING: Xvfb not found. Install with: apt-get install xvfb", file=sys.stderr)
        return None


def _stop_virtual_display(vdisplay):
    """Stop the virtual display if one was started."""
    if vdisplay is None:
        return
    try:
        if hasattr(vdisplay, "stop"):
            vdisplay.stop()  # PyVirtualDisplay
        elif hasattr(vdisplay, "terminate"):
            vdisplay.terminate()  # subprocess.Popen
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Fetch utility bill with undetected Chrome")
    parser.add_argument("--url", required=True, help="Login page URL")
    parser.add_argument("--username", required=False)
    parser.add_argument("--password", required=False)
    parser.add_argument("--stdin", action="store_true", help="Read credentials from stdin JSON")
    parser.add_argument("--timeout", type=int, default=90, help="Page load timeout (seconds)")
    parser.add_argument("--headless", action="store_true", help="Force headless (less reliable for anti-bot)")
    parser.add_argument("--debug", action="store_true", help="Verbose stderr output")
    parser.add_argument("--gemini-key", required=False, help="Gemini API key for LLM reasoning")
    parser.add_argument("--gemini-model", default="gemini-2.5-flash", help="Gemini model name")
    parser.add_argument("--max-llm-steps", type=int, default=8, help="Max LLM reasoning steps")
    # 2FA resume mode
    parser.add_argument("--resume", action="store_true", help="Resume a 2FA session")
    parser.add_argument("--session-file", required=False, help="Path to saved session cookies")
    parser.add_argument("--code", required=False, help="2FA verification code")
    args = parser.parse_args()

    username = args.username
    password = args.password
    twofa_code = args.code
    gemini_key = args.gemini_key
    account_hint = ""  # From credential notes — helps select the right account
    if args.stdin:
        cred_data = json.loads(sys.stdin.read())
        username = cred_data.get("username", username)
        password = cred_data.get("password", password)
        twofa_code = cred_data.get("code", twofa_code)
        gemini_key = cred_data.get("geminiKey", gemini_key)
        account_hint = cred_data.get("notes", "")

    # Also check env var for API key
    if not gemini_key:
        gemini_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""

    # Debug: log credential presence (masked for security)
    dbg = lambda msg: sys.stderr.write(f"[fetchBill] {msg}\n") if args.debug else None
    dbg(f"Credentials received: username={'YES ('+str(len(username or ''))+' chars)' if username else 'EMPTY'}, "
        f"password={'YES ('+str(len(password or ''))+' chars)' if password else 'EMPTY'}, "
        f"gemini_key={'YES' if gemini_key else 'EMPTY'}, "
        f"notes='{(account_hint or '')[:30]}'")

    if not args.resume and (not username or not password):
        print(json.dumps({"ok": False, "error": "Username and password required"}))
        sys.exit(1)

    if args.resume and (not args.session_file or not twofa_code):
        print(json.dumps({"ok": False, "error": "Resume mode requires --session-file and --code (or code via stdin)"}))
        sys.exit(1)

    result = {
        "ok": False,
        "mode": "undetected-chrome",
        "url": args.url,
        "steps": [],
        "amountsFound": [],
        "datesFound": [],
        "pageText": "",
        "pageTitle": "",
        "screenshot": None,
        "error": None,
    }

    driver = None
    vdisplay = None
    try:
        import undetected_chromedriver as uc
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.action_chains import ActionChains

        def dbg(msg):
            if args.debug:
                print(f"[fetchBill] {msg}", file=sys.stderr)

        def add_step(action, desc):
            result["steps"].append({
                "step": len(result["steps"]) + 1,
                "action": action,
                "description": desc,
            })
            dbg(f"Step {len(result['steps'])}: {action} — {desc}")

        # ── Start virtual display on cloud (Linux without $DISPLAY) ──
        if not args.headless:
            vdisplay = _start_virtual_display(debug=args.debug)

        is_cloud = platform.system() == "Linux"
        dbg(f"Platform: {platform.system()}, cloud={is_cloud}, headless={args.headless}")

        options = uc.ChromeOptions()
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1280,900")
        options.add_argument("--lang=en-US,en")
        options.add_argument("--disable-infobars")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--disable-blink-features=AutomationControlled")
        # Suppress "Save Password" and credential dialogs via flags (UC doesn't support experimental_option)
        options.add_argument("--disable-save-password-bubble")
        options.add_argument("--password-store=basic")
        options.add_argument("--disable-features=PasswordLeakDetection,AutofillServerCommunication")

        # On cloud Linux, add extra stability flags
        if is_cloud:
            options.add_argument("--disable-gpu")
            options.add_argument("--disable-software-rasterizer")

        if args.headless:
            options.add_argument("--headless=new")

        # Launch — non-headless by default (real window on local, Xvfb on cloud)
        driver = uc.Chrome(options=options, use_subprocess=True)
        driver.set_page_load_timeout(args.timeout)
        driver.implicitly_wait(3)

        # Position window off-screen on local dev (doesn't matter on cloud/Xvfb)
        if not is_cloud:
            try:
                driver.set_window_position(2000, 0)
            except Exception:
                pass
        driver.set_window_size(1280, 900)

        login_success = False

        # ── Navigate ──────────────────────────────────────────
        add_step("navigate", f"Opening {args.url}")
        driver.get(args.url)
        random_delay(4.0, 7.0)

        # ── RESUME MODE: Load cookies and enter 2FA code ─────
        if args.resume:
            # Load saved cookies
            try:
                with open(args.session_file, "r") as f:
                    session_data = json.load(f)
                cookies = session_data.get("cookies", [])
                resume_url = session_data.get("url", args.url)

                for cookie in cookies:
                    # Remove problematic fields
                    for key in ["sameSite", "expiry"]:
                        cookie.pop(key, None)
                    try:
                        driver.add_cookie(cookie)
                    except Exception:
                        pass

                add_step("navigate", "Loaded session cookies, returning to 2FA page")
                driver.get(resume_url)
                random_delay(3.0, 5.0)
            except Exception as e:
                add_step("fail", f"Failed to load session: {e}")
                result["error"] = f"Session load failed: {e}"
                print(json.dumps(result))
                return

            # Look for verification code input
            code_entered = False
            for code_attempt in range(3):
                random_delay(1.0, 2.0)
                body_text = _safe_body_text(driver)

                # Check if we need to click "Text" button to resend
                if "verification code" in body_text.lower() or "verify" in body_text.lower():
                    # Look for OTP input field
                    code_fields = driver.find_elements(By.CSS_SELECTOR,
                        'input[type="text"], input[type="tel"], input[type="number"], '
                        'input[name*="code" i], input[name*="otp" i], input[name*="pin" i], '
                        'input[id*="code" i], input[id*="otp" i], input[id*="pin" i], '
                        'input[autocomplete="one-time-code"]'
                    )
                    code_fields = [f for f in code_fields if f.is_displayed()]

                    if code_fields:
                        add_step("type", "Entering 2FA verification code")
                        human_click(driver, code_fields[0])
                        random_delay(0.3, 0.6)
                        code_fields[0].clear()
                        human_type(code_fields[0], twofa_code)
                        random_delay(1.0, 2.0)

                        # Click verify/submit button
                        btn = _find_action_button(driver, ["verify", "submit", "continue", "confirm", "next"])
                        if btn:
                            add_step("click", f"Clicking '{btn.text.strip() or 'Verify'}'")
                            human_click(driver, btn)
                        else:
                            code_fields[0].send_keys(Keys.ENTER)
                            add_step("press_key", "Pressing Enter to verify")

                        random_delay(5.0, 8.0)
                        code_entered = True
                        login_success = True
                        add_step("wait", "2FA code submitted, waiting for portal")
                        break
                    else:
                        dbg(f"2FA page detected but no code input found (attempt {code_attempt + 1})")
                        random_delay(2.0, 3.0)
                else:
                    # Maybe already past 2FA
                    login_success = True
                    add_step("done", "Already past verification page")
                    break

            if not code_entered and not login_success:
                add_step("fail", "Could not find 2FA code input field")
                result["error"] = "Could not find where to enter the 2FA code"

            # ── Post-2FA: wait for page transition & dismiss popups ──
            if login_success:
                _post_login_settle(driver, add_step, dbg)
        else:
            # ── NORMAL MODE: Login flow ───────────────────────
            # Mimic human: move mouse, small scroll
            random_mouse_wander(driver)
            random_scroll(driver)
            random_delay(1.0, 2.0)

            login_success = _do_login(driver, username, password, args, result, add_step, dbg, gemini_key)

        # ── Detect 2FA page after login ───────────────────────
        if not args.resume and login_success:
            body_text = _safe_body_text(driver)
            is_2fa = _detect_2fa_page(body_text, driver)

            if is_2fa:
                dbg("2FA verification page detected!")

                # Click "Text" option to send the code
                tfa_channel = _click_2fa_channel(driver, add_step, dbg, prefer="text")
                random_delay(3.0, 5.0)

                # Save cookies + page state for resume
                session_file = _save_session(driver, args.url)
                add_step("wait", f"2FA code requested via {tfa_channel}. Waiting for user input.")

                # Take screenshot of 2FA page
                try:
                    ss = driver.get_screenshot_as_png()
                    result["screenshot"] = f"data:image/png;base64,{base64.b64encode(ss).decode()}"
                except Exception:
                    pass

                result["needs2fa"] = True
                result["tfaChannel"] = tfa_channel
                result["sessionFile"] = session_file
                result["pageText"] = body_text[:4000]
                result["pageTitle"] = driver.title
                result["url"] = driver.current_url
                result["ok"] = False
                result["error"] = None
                result["note"] = f"2FA verification required. Code sent via {tfa_channel}. Enter it below."

                print(json.dumps(result))
                return
            elif login_success:
                # No 2FA — settle after normal login
                _post_login_settle(driver, add_step, dbg)

        # ── Extract billing data (LLM-powered or fallback regex) ─────
        random_delay(2.0, 4.0)
        try:
            if login_success and gemini_key:
                # ── LLM REASONING AGENT ──────────────────────
                add_step("llm", "Starting LLM-guided billing navigation")
                llm_result = _llm_reasoning_loop(
                    driver, gemini_key, args.gemini_model,
                    args.max_llm_steps, add_step, dbg, account_hint,
                )
                if llm_result.get("amounts"):
                    result["amountsFound"] = llm_result["amounts"]
                if llm_result.get("dates"):
                    result["datesFound"] = llm_result["dates"]
                if llm_result.get("billingData"):
                    result["billingData"] = llm_result["billingData"]
                if llm_result.get("error"):
                    result["error"] = llm_result["error"]
            elif login_success:
                # ── FALLBACK: basic keyword navigation + regex ─
                _try_navigate_to_billing(driver, add_step)
                random_delay(3.0, 5.0)

            page_text = _safe_body_text(driver)
            result["pageText"] = page_text[:8000]
            result["pageTitle"] = driver.title
            result["url"] = driver.current_url

            # Always do regex extraction (supplements LLM data)
            amounts = re.findall(r'\$[\d,]+\.?\d{0,2}', page_text)
            if not result.get("amountsFound"):
                result["amountsFound"] = list(dict.fromkeys(amounts))[:20]

            dates = re.findall(
                r'\b(?:\w+ \d{1,2},?\s*\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b',
                page_text,
            )
            if not result.get("datesFound"):
                result["datesFound"] = list(dict.fromkeys(dates))[:20]

            add_step(
                "done" if login_success else "fail",
                f"Page extracted: {len(result.get('amountsFound', []))} amounts, {len(result.get('datesFound', []))} dates",
            )
        except Exception as e:
            add_step("fail", f"Extract error: {e}")

        # ── Screenshot ────────────────────────────────────────
        try:
            ss = driver.get_screenshot_as_png()
            result["screenshot"] = f"data:image/png;base64,{base64.b64encode(ss).decode()}"
        except Exception as e:
            dbg(f"Screenshot failed: {e}")

        result["ok"] = login_success

    except Exception as e:
        result["error"] = f"Driver error: {e}"
        if args.debug:
            traceback.print_exc(file=sys.stderr)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        _stop_virtual_display(vdisplay)

    print(json.dumps(result))


# ── LLM Reasoning Agent ──────────────────────────────────────

def _init_gemini(api_key, model_name="gemini-2.5-flash"):
    """Initialize Gemini client. Returns model or None."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        # Use thinking budget to prevent gemini-2.5-flash from overthinking
        model = genai.GenerativeModel(
            model_name,
            generation_config={
                "temperature": 0.2,
                "max_output_tokens": 2048,
            },
        )
        return model
    except Exception as e:
        return None


def _take_screenshot_b64(driver):
    """Take a screenshot and return as base64 string."""
    try:
        return base64.b64encode(driver.get_screenshot_as_png()).decode()
    except Exception:
        return None


def _get_page_context(driver):
    """Get comprehensive page context for LLM analysis."""
    try:
        from selenium.webdriver.common.by import By
        page_text = _safe_body_text(driver)

        # Collect ALL potentially interactive elements — not just a/button
        clickable_info = []
        seen_texts = set()
        selectors = [
            "a", "button",
            "div[role='button']", "span[role='button']",
            "[role='option']", "[role='menuitem']", "[role='tab']",
            "[role='link']", "[role='listitem']",
            "li[class*='account' i]", "li[class*='item' i]", "li[class*='option' i]",
            "div[class*='account' i]", "div[class*='card' i]", "div[class*='item' i]",
            "div[class*='select' i]", "div[class*='option' i]", "div[class*='clickable' i]",
            "label", "input[type='radio']",
            "tr[class*='account' i]", "td",
            "[data-testid]", "[onclick]",
        ]
        for sel in selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, sel)
            except Exception:
                continue
            for el in elements:
                if len(clickable_info) >= 80:
                    break
                try:
                    if not el.is_displayed():
                        continue
                    txt = (el.text or "").strip()
                    href = el.get_attribute("href") or ""
                    aria = el.get_attribute("aria-label") or ""
                    data_id = el.get_attribute("data-testid") or ""
                    tag = el.tag_name
                    cls = (el.get_attribute("class") or "")[:80]
                    el_id = el.get_attribute("id") or ""

                    # Skip empty elements and dedup by text
                    display_text = txt[:120]
                    if not display_text and not href and not aria and not data_id:
                        continue
                    dedup_key = f"{tag}:{display_text[:60]}:{href[:40]}"
                    if dedup_key in seen_texts:
                        continue
                    seen_texts.add(dedup_key)

                    clickable_info.append({
                        "index": len(clickable_info),
                        "tag": tag,
                        "text": display_text,
                        "href": href[:200] if href else "",
                        "ariaLabel": aria[:100] if aria else "",
                        "id": el_id[:60] if el_id else "",
                        "class": cls,
                        "dataTestId": data_id[:60] if data_id else "",
                    })
                except Exception:
                    continue

        # Get nav/menu items specifically
        nav_items = []
        nav_els = driver.find_elements(By.CSS_SELECTOR,
            "nav a, .nav a, [role='navigation'] a, .menu a, .sidebar a, "
            "[class*='menu'] a, [class*='nav'] a, [class*='tab'] a, [class*='tab'] button"
        )
        for el in nav_els:
            if el.is_displayed():
                txt = (el.text or "").strip()
                if txt:
                    nav_items.append(txt)

        return {
            "url": driver.current_url,
            "title": driver.title,
            "bodyText": page_text[:6000],
            "clickableElements": clickable_info[:80],
            "navItems": nav_items[:30],
        }
    except Exception:
        return {
            "url": driver.current_url,
            "title": driver.title,
            "bodyText": _safe_body_text(driver)[:4000],
            "clickableElements": [],
            "navItems": [],
        }


def _ask_gemini(model, screenshot_b64, page_context, step_num, account_hint="", dbg=None):
    """Ask Gemini to analyze the page and decide what to do next.
    Returns a dict with: action, target, reasoning, done, billingData."""
    if dbg is None:
        dbg = lambda msg: None  # no-op if not provided

    account_section = ""
    if account_hint:
        account_section = f"""
IMPORTANT - TARGET ACCOUNT:
The user's notes say: "{account_hint}"
If you see multiple accounts on this page, you MUST select the one matching this account number/description.
Click on the account that contains this number or matches this description before navigating to billing.
"""

    prompt = f"""You are a billing extraction agent on a utility provider's portal.
You are already logged in. Your ONLY goal is to extract the latest bill amount and due date.
{account_section}
Current page:
- URL: {page_context['url']}
- Title: {page_context['title']}
- Step: {step_num}

Page text (first 4000 chars):
{page_context.get('bodyText', '')[:4000]}

Clickable elements (index, tag, text, href):
{json.dumps(page_context.get('clickableElements', [])[:30], indent=2)}

CRITICAL RULES:
1. EXTRACT FIRST: If you see ANY dollar amounts or dates on this page, set "done": true and extract them immediately. Do NOT navigate away.
2. The account overview/dashboard page usually already shows the bill amount and due date. LOOK CAREFULLY at the page text above.
3. Only click to navigate if there are absolutely NO amounts visible on the current page.
4. Never click more than 2 times total. If after 2 clicks you still don't see billing data, extract whatever you can see.
5. DO NOT click on individual bills, statements, or PDF links — just read the amounts from the page.
6. Look for patterns like "$123.45", "Amount Due", "Balance", "Payment Due", "Due Date" in the page text.

Respond with EXACTLY this JSON (no markdown, no code blocks):
{{
  "reasoning": "Brief explanation",
  "done": true/false,
  "action": "click" or "extract" or "scroll",
  "targetIndex": <index of clickable element, or -1>,
  "targetText": "<element text for fallback>",
  "targetCssSelector": "<CSS selector fallback>",
  "targetUrl": "",
  "billingData": {{
    "totalAmountDue": "$XX.XX or null",
    "dueDate": "date string or null",
    "billingPeriod": "period string or null",
    "accountNumber": "number or null",
    "lastPayment": "$XX.XX or null",
    "lastPaymentDate": "date or null",
    "planName": "plan name or null",
    "allAmounts": ["$XX.XX", ...],
    "allDates": ["date", ...]
  }}
}}

Output ONLY the JSON object, nothing else."""

    try:
        parts = [prompt]

        # Add screenshot if available (vision)
        if screenshot_b64:
            image_bytes = base64.b64decode(screenshot_b64)
            parts.insert(0, {
                "mime_type": "image/png",
                "data": image_bytes,
            })

        dbg(f"Calling Gemini API (step {step_num})...")

        import threading as _threading

        # Use a thread with timeout to prevent hanging
        api_result = [None]
        api_error = [None]

        def _call_gemini():
            try:
                api_result[0] = model.generate_content(parts)
            except Exception as e:
                api_error[0] = e

        # Retry up to 3 times for transient errors (503, 429, etc.)
        last_err = None
        for _retry in range(3):
            api_result[0] = None
            api_error[0] = None

            thread = _threading.Thread(target=_call_gemini)
            thread.start()
            thread.join(timeout=60)  # 60 second timeout per LLM call

            if thread.is_alive():
                dbg(f"Gemini API timed out after 60s (step {step_num})")
                last_err = "timeout"
                random_delay(2.0, 4.0)
                continue

            if api_error[0]:
                err_str = str(api_error[0])
                # Retry on transient errors (503, 429, 500)
                if any(code in err_str for code in ["503", "429", "500", "Service Unavailable", "high demand", "RESOURCE_EXHAUSTED", "overloaded"]):
                    dbg(f"Gemini transient error (retry {_retry+1}/3): {err_str[:100]}")
                    last_err = api_error[0]
                    random_delay(5.0 * (_retry + 1), 10.0 * (_retry + 1))  # Exponential backoff
                    continue
                else:
                    raise api_error[0]

            # Success
            last_err = None
            break
        else:
            # All retries exhausted
            if last_err == "timeout":
                return {
                    "reasoning": "Gemini API timed out after multiple attempts",
                    "done": False, "action": "scroll", "billingData": {},
                }
            elif last_err:
                return {
                    "reasoning": f"Gemini API error after retries: {str(last_err)[:150]}",
                    "done": False, "action": "scroll", "billingData": {},
                }

        response = api_result[0]
        dbg(f"Gemini responded (step {step_num})")

        # Parse the response — be aggressive about finding JSON
        text = response.text.strip()
        # Remove markdown code blocks if present
        if text.startswith("```"):
            text = re.sub(r'^```\w*\n?', '', text)
            text = re.sub(r'\n?```$', '', text)
        text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try to extract JSON object from mixed text
        json_match = re.search(r'\{[\s\S]*"reasoning"[\s\S]*"done"[\s\S]*\}', text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        # Try finding any JSON block in the response
        brace_start = text.find('{')
        if brace_start >= 0:
            depth = 0
            for i in range(brace_start, len(text)):
                if text[i] == '{': depth += 1
                elif text[i] == '}': depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[brace_start:i+1])
                    except json.JSONDecodeError:
                        break

        # Detect if LLM is saying we're still on login page
        lower_text = text.lower()
        if any(kw in lower_text for kw in ["login", "sign in", "sign-in", "log in", "still on", "login portal", "login page"]):
            return {
                "reasoning": f"LLM says still on login page: {text[:200]}",
                "done": False, "action": "navigate", "billingData": {},
                "_still_on_login": True,
            }

        return {
            "reasoning": f"Failed to parse LLM response: {text[:200]}",
            "done": False, "action": "scroll", "billingData": {},
        }
    except Exception as e:
        return {
            "reasoning": f"LLM error: {e}",
            "done": False, "action": "extract", "billingData": {},
        }


def _execute_llm_action(driver, action_result, page_context, add_step, dbg):
    """Execute the action recommended by the LLM."""
    from selenium.webdriver.common.by import By

    action = action_result.get("action", "extract")
    target_idx = action_result.get("targetIndex", -1)
    target_url = action_result.get("targetUrl", "")
    target_text = action_result.get("targetText", "")
    target_css = action_result.get("targetCssSelector", "")
    reasoning = action_result.get("reasoning", "")

    dbg(f"LLM reasoning: {reasoning}")
    dbg(f"LLM action: {action}, idx={target_idx}, text='{target_text[:50]}', css='{target_css}'")

    if action == "click":
        el = None

        # Strategy 1: Try by index from clickable elements list
        if target_idx >= 0:
            clickable = page_context.get("clickableElements", [])
            if target_idx < len(clickable):
                info = clickable[target_idx]
                add_step("llm_click", f"LLM: Clicking '{info.get('text', '')[:60]}' ({info.get('tag', '')})")
                try:
                    tag = info.get("tag", "a")
                    text = info.get("text", "")
                    href = info.get("href", "")
                    el_id = info.get("id", "")

                    # Try by ID first (most reliable)
                    if el_id:
                        try:
                            found = driver.find_element(By.ID, el_id)
                            if found.is_displayed():
                                el = found
                        except Exception:
                            pass

                    # Try by tag + text match
                    if not el:
                        candidates = driver.find_elements(By.CSS_SELECTOR, tag)
                        for c in candidates:
                            if not c.is_displayed():
                                continue
                            c_text = (c.text or "").strip()
                            c_href = c.get_attribute("href") or ""
                            if text and c_text and text[:40] in c_text:
                                el = c
                                break
                            if href and href in c_href:
                                el = c
                                break
                except Exception as e:
                    dbg(f"Index-based click failed: {e}")

        # Strategy 2: Try CSS selector from LLM
        if not el and target_css:
            try:
                dbg(f"  Trying LLM CSS selector: {target_css}")
                found_els = driver.find_elements(By.CSS_SELECTOR, target_css)
                for f in found_els:
                    if f.is_displayed():
                        el = f
                        add_step("llm_click", f"LLM: Clicking via CSS '{target_css[:50]}'")
                        break
            except Exception as e:
                dbg(f"  CSS selector failed: {e}")

        # Strategy 3: Try by exact text match via XPath
        if not el and target_text:
            try:
                dbg(f"  Trying text match: '{target_text[:50]}'")
                # Try XPath contains for the text
                xpath_query = f"//*[contains(text(), '{target_text[:60]}')]"
                found_els = driver.find_elements(By.XPATH, xpath_query)
                for f in found_els:
                    if f.is_displayed():
                        el = f
                        add_step("llm_click", f"LLM: Clicking text '{target_text[:50]}'")
                        break
            except Exception as e:
                dbg(f"  XPath text match failed: {e}")

        # Strategy 4: Try partial text match via JavaScript (handles nested text)
        if not el and target_text:
            try:
                dbg(f"  Trying JS text search for: '{target_text[:50]}'")
                el = driver.execute_script('''
                    let target = arguments[0];
                    let all = document.querySelectorAll('a, button, div, span, li, label, tr, td, [role="button"], [role="option"], [role="link"], [role="menuitem"], [onclick]');
                    for (let el of all) {
                        if (!el.offsetParent && !el.offsetWidth) continue;
                        let t = (el.textContent || '').trim();
                        if (t && t.includes(target)) return el;
                    }
                    return null;
                ''', target_text[:80])
                if el:
                    add_step("llm_click", f"LLM: Clicking (JS found) '{target_text[:50]}'")
            except Exception as e:
                dbg(f"  JS text search failed: {e}")

        # Strategy 5: Try clicking at coordinates if LLM described a location
        # (last resort — click the first visible element containing account number)
        if not el and target_text:
            try:
                # Try any element containing any part of the target text (e.g., account number)
                import re as _re
                digits = _re.findall(r'\d{4,}', target_text)
                for d in digits:
                    dbg(f"  Looking for element containing digits: {d}")
                    el = driver.execute_script('''
                        let target = arguments[0];
                        let all = document.querySelectorAll('*');
                        for (let el of all) {
                            if (!el.offsetParent && !el.offsetWidth) continue;
                            if (el.children.length > 5) continue;
                            let t = (el.textContent || '').trim();
                            if (t.includes(target) && t.length < 500) return el;
                        }
                        return null;
                    ''', d)
                    if el:
                        add_step("llm_click", f"LLM: Clicking element with '{d}'")
                        break
            except Exception as e:
                dbg(f"  Digit-based search failed: {e}")

        if el:
            try:
                human_click(driver, el)
                random_delay(3.0, 6.0)
                return True
            except Exception as e:
                dbg(f"  Click execution failed: {e}")
                # Try JS click as fallback
                try:
                    driver.execute_script("arguments[0].click();", el)
                    random_delay(3.0, 6.0)
                    return True
                except Exception:
                    pass
        else:
            dbg(f"  Could not find any element to click")
            # If we have a URL hint, try navigating
            if target_idx >= 0:
                clickable = page_context.get("clickableElements", [])
                if target_idx < len(clickable):
                    href = clickable[target_idx].get("href", "")
                    if href and href.startswith("http"):
                        dbg(f"  Falling back to direct navigation: {href[:80]}")
                        driver.get(href)
                        random_delay(3.0, 5.0)
                        return True

    elif action == "navigate" and target_url:
        add_step("llm_navigate", f"LLM: Navigating to {target_url[:80]}")
        try:
            driver.get(target_url)
            random_delay(3.0, 5.0)
            return True
        except Exception as e:
            dbg(f"Navigate failed: {e}")

    elif action == "scroll":
        add_step("llm_scroll", "LLM: Scrolling to see more content")
        try:
            driver.execute_script("window.scrollBy(0, 400);")
            random_delay(1.5, 3.0)
            return True
        except Exception:
            pass

    return False


def _try_select_account(driver, account_hint, add_step, dbg):
    """If multiple accounts are shown, try to click the one matching account_hint (from notes)."""
    from selenium.webdriver.common.by import By

    if not account_hint:
        return

    dbg(f"Account hint from notes: '{account_hint}'")

    # Extract potential account numbers/identifiers from the hint
    # Common patterns: "Account: 123456789", "Acct #123456789", just digits, etc.
    hint_lower = account_hint.lower().strip()
    # Extract all digit sequences of 4+ chars from notes (likely account numbers)
    import re as _re
    digit_sequences = _re.findall(r'\d{4,}', account_hint)
    # Also use any non-empty words as matching candidates
    hint_words = [w.strip() for w in hint_lower.split() if len(w.strip()) >= 3]

    dbg(f"  Digit sequences from hint: {digit_sequences}")
    dbg(f"  Hint words: {hint_words}")

    random_delay(1.0, 2.0)
    body = _safe_body_text(driver)

    # Check if this looks like an account selection page
    acct_keywords = ["select an account", "choose account", "which account",
                     "select account", "multiple accounts", "account list"]
    looks_like_account_page = any(kw in body.lower() for kw in acct_keywords)

    if not looks_like_account_page:
        # Even without explicit "select account" text, check for multiple clickable
        # elements containing account-like numbers
        dbg("  Page doesn't explicitly say 'select account', checking for account-like links")

    # Strategy 1: Find clickable elements containing the account number
    all_clickable = driver.find_elements(By.CSS_SELECTOR,
        'a, button, [role="button"], [role="link"], '
        'div[class*="account" i], div[class*="card" i], '
        'li[class*="account" i], tr, .account-item, .account-card'
    )

    for el in all_clickable:
        try:
            if not el.is_displayed():
                continue
            el_text = (el.text or "").strip()
            if not el_text:
                continue

            # Check if any digit sequence from the hint appears in this element
            matched = False
            for digits in digit_sequences:
                if digits in el_text:
                    dbg(f"  MATCH: Found account '{digits}' in element: '{el_text[:100]}'")
                    add_step("click", f"Selecting account matching '{digits}'")
                    human_click(driver, el)
                    random_delay(3.0, 5.0)
                    matched = True
                    break

            if matched:
                return

            # Check full hint text match (if notes is just the account number)
            if hint_lower in el_text.lower():
                dbg(f"  MATCH: Hint text found in element: '{el_text[:100]}'")
                add_step("click", f"Selecting account matching '{account_hint[:50]}'")
                human_click(driver, el)
                random_delay(3.0, 5.0)
                return
        except Exception:
            continue

    dbg("  No matching account element found via direct search, LLM will handle it")


def _llm_reasoning_loop(driver, api_key, model_name, max_steps, add_step, dbg, account_hint=""):
    """Run the LLM reasoning loop to navigate and extract billing data."""
    model = _init_gemini(api_key, model_name)
    if not model:
        dbg("Gemini init failed, falling back to basic extraction")
        _try_navigate_to_billing(driver, add_step)
        return {"error": "LLM not available"}

    # If we have an account hint, try to select the right account first
    if account_hint:
        _try_select_account(driver, account_hint, add_step, dbg)

    dbg(f"LLM reasoning agent started (model={model_name}, max_steps={max_steps})")
    extracted = {"amounts": [], "dates": [], "billingData": None, "error": None}

    # Wait for SPA content to render — but don't wait too long for SPA sites
    # that load content into Shadow DOM (body text stays short)
    for _spa_wait in range(3):
        body = _safe_body_text(driver)
        if len(body) > 800:
            break
        dbg(f"  Waiting for page content to load ({len(body)} chars)...")
        random_delay(3.0, 5.0)
    else:
        dbg(f"  Page content still sparse ({len(body)} chars), proceeding anyway")

    for step in range(max_steps):
        dbg(f"LLM step {step + 1}/{max_steps}")

        # Capture page state
        screenshot = _take_screenshot_b64(driver)
        context = _get_page_context(driver)

        # Ask LLM
        llm_response = _ask_gemini(model, screenshot, context, step + 1, account_hint, dbg=dbg)

        reasoning = llm_response.get("reasoning", "No reasoning")
        add_step("llm_think", f"LLM step {step + 1}: {reasoning[:150]}")

        # Check if done
        if llm_response.get("done"):
            billing_data = llm_response.get("billingData", {})
            if billing_data:
                extracted["billingData"] = billing_data
                all_amounts = billing_data.get("allAmounts", [])
                all_dates = billing_data.get("allDates", [])
                total = billing_data.get("totalAmountDue")
                due_date = billing_data.get("dueDate")
                if total:
                    all_amounts.insert(0, total)
                if due_date:
                    all_dates.insert(0, due_date)
                extracted["amounts"] = list(dict.fromkeys(all_amounts))[:20]
                extracted["dates"] = list(dict.fromkeys(all_dates))[:20]

            add_step("llm_done", f"LLM extracted billing data: {json.dumps(billing_data)[:200]}")
            dbg(f"LLM done: {json.dumps(billing_data)[:500]}")
            break

        # Handle special case: LLM detects we're still on login page
        if llm_response.get("_still_on_login"):
            dbg("LLM says we're still on login page — trying to recover")
            add_step("llm_think", "LLM detected still on login page, attempting recovery")
            # Try scrolling or clicking something to advance the page
            try:
                from selenium.webdriver.common.keys import Keys
                from selenium.webdriver.common.action_chains import ActionChains
                # Press ESC to dismiss any overlay, then try clicking first visible link
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
                random_delay(1.0, 2.0)
                # Try clicking the first visible link that looks like nav
                links = driver.find_elements(By.CSS_SELECTOR, 'a[href]')
                for lnk in links:
                    try:
                        if not lnk.is_displayed():
                            continue
                        txt = (lnk.text or "").strip().lower()
                        if any(kw in txt for kw in ["account", "bill", "overview", "home", "dashboard", "portal"]):
                            dbg(f"  Clicking recovery link: '{txt}'")
                            human_click(driver, lnk)
                            random_delay(3.0, 5.0)
                            break
                    except Exception:
                        continue
                else:
                    # Try refreshing the page
                    driver.refresh()
                    random_delay(3.0, 5.0)
            except Exception as e:
                dbg(f"  Recovery failed: {e}")
            continue

        # Execute action
        success = _execute_llm_action(driver, llm_response, context, add_step, dbg)
        if not success:
            dbg(f"LLM action failed at step {step + 1}, trying next step")
            random_delay(1.0, 2.0)

        random_delay(1.5, 3.0)

    return extracted


# ── Helpers ──────────────────────────────────────────────────

def _find_inputs_via_js(driver, dbg):
    """Use JavaScript to find all inputs including inside shadow DOMs."""
    try:
        result = driver.execute_script('''
            function findInputs(root) {
                let inputs = Array.from(root.querySelectorAll('input'));
                root.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) {
                        inputs.push(...findInputs(el.shadowRoot));
                    }
                });
                return inputs;
            }
            let all = findInputs(document);
            return all.map(i => ({
                type: i.type || '',
                name: i.name || '',
                id: i.id || '',
                placeholder: i.placeholder || '',
                ariaLabel: i.getAttribute('aria-label') || '',
                visible: !!(i.offsetParent || i.offsetWidth || i.offsetHeight),
                tag: i.tagName
            }));
        ''')
        if result:
            dbg(f"  JS found {len(result)} inputs: {json.dumps(result[:10])}")
        return result or []
    except Exception as e:
        dbg(f"  JS input search failed: {e}")
        return []


def _ask_gemini_login(model, screenshot_b64, page_context):
    """Ask Gemini to analyze a login page and identify form elements.
    Returns a dict with: action, reasoning, elements found."""

    prompt = f"""You are a login automation agent. Analyze this login page and tell me EXACTLY how to log in.

Current page:
- URL: {page_context['url']}
- Title: {page_context['title']}

All visible elements on the page (index, tag, text, href):
{json.dumps(page_context.get('clickableElements', [])[:50], indent=2)}

Page text (partial):
{page_context.get('bodyText', '')[:3000]}

INSTRUCTIONS:
1. Look at the screenshot and page content to find the login form.
2. Identify the username/email input field, password input field, and login/submit button.
3. Some pages show username first, then password on next step. That's fine — identify what's currently visible.
4. The form might use custom web components, overlays, or non-standard input elements.
5. If you see a "Sign in" or "Log in" link/button that needs to be clicked FIRST before a form appears, tell me.

Respond with EXACTLY this JSON (no markdown, no code blocks):
{{
  "reasoning": "What I see on this page and how to log in",
  "pageState": "login_form" or "pre_login" or "username_step" or "password_step" or "already_logged_in" or "unknown",
  "usernameField": {{
    "found": true/false,
    "clickableIndex": <index from the elements list to click for username, or -1>,
    "cssSelector": "<CSS selector to find the input, or empty>",
    "description": "Description of where the username field is"
  }},
  "passwordField": {{
    "found": true/false,
    "clickableIndex": <index, or -1>,
    "cssSelector": "<CSS selector, or empty>",
    "description": "Description"
  }},
  "submitButton": {{
    "found": true/false,
    "clickableIndex": <index from elements list, or -1>,
    "text": "Button text like 'Sign In' or 'Continue'",
    "cssSelector": "<CSS selector, or empty>"
  }},
  "preAction": {{
    "needed": true/false,
    "clickableIndex": <index of element to click first, or -1>,
    "description": "e.g. 'Click Sign In link to reveal form'"
  }}
}}

Output ONLY the JSON, nothing else."""

    try:
        parts = [prompt]
        if screenshot_b64:
            image_bytes = base64.b64decode(screenshot_b64)
            parts.insert(0, {"mime_type": "image/png", "data": image_bytes})

        response = model.generate_content(parts)
        text = response.text.strip()
        if text.startswith("```"):
            text = re.sub(r'^```\w*\n?', '', text)
            text = re.sub(r'\n?```$', '', text)
        text = text.strip()
        return json.loads(text)
    except Exception as e:
        return {"reasoning": f"LLM login analysis error: {e}", "pageState": "unknown"}


def _llm_assisted_login(driver, model, username, password, add_step, dbg):
    """Use LLM to find and fill login form. Returns 'submitted', 'username_entered', or 'failed'."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys

    screenshot = _take_screenshot_b64(driver)
    context = _get_page_context(driver)

    # Also add all input elements to context for the LLM
    try:
        all_inputs = driver.execute_script('''
            return Array.from(document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]')).map((el, i) => ({
                index: i,
                tag: el.tagName,
                type: el.type || '',
                name: el.name || '',
                id: el.id || '',
                placeholder: el.placeholder || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                visible: !!(el.offsetParent || el.offsetWidth || el.offsetHeight),
                className: (el.className || '').toString().substring(0, 100)
            }));
        ''')
        context["inputElements"] = [i for i in (all_inputs or []) if i.get("visible")]
        dbg(f"  LLM sees {len(context.get('inputElements', []))} visible input elements")
    except Exception:
        context["inputElements"] = []

    llm_result = _ask_gemini_login(model, screenshot, context)
    reasoning = llm_result.get("reasoning", "")
    page_state = llm_result.get("pageState", "unknown")
    dbg(f"  LLM login analysis: state={page_state}, reasoning={reasoning[:150]}")
    add_step("llm_think", f"LLM login: {reasoning[:120]}")

    if page_state == "already_logged_in":
        add_step("done", "LLM says already logged in")
        return "submitted"

    # Handle pre-action (e.g., click a "Sign In" link to reveal form)
    pre_action = llm_result.get("preAction", {})
    if pre_action.get("needed") and pre_action.get("clickableIndex", -1) >= 0:
        idx = pre_action["clickableIndex"]
        clickables = context.get("clickableElements", [])
        if idx < len(clickables):
            desc = pre_action.get("description", "pre-login click")
            add_step("llm_click", f"LLM: {desc}")
            _click_element_by_index(driver, context, idx, dbg)
            random_delay(3.0, 5.0)
            # Re-analyze after pre-action
            return _llm_assisted_login(driver, model, username, password, add_step, dbg)

    # Try to find and fill username field
    user_info = llm_result.get("usernameField", {})
    pass_info = llm_result.get("passwordField", {})
    submit_info = llm_result.get("submitButton", {})

    username_entered = False
    password_entered = False

    # Fill username
    if user_info.get("found"):
        field = None
        # Try CSS selector first
        css = user_info.get("cssSelector", "")
        if css:
            try:
                fields = driver.find_elements(By.CSS_SELECTOR, css)
                field = next((f for f in fields if f.is_displayed()), None)
                dbg(f"  LLM CSS selector '{css}' found: {field is not None}")
            except Exception:
                pass

        # Try clickable index
        if not field and user_info.get("clickableIndex", -1) >= 0:
            field = _get_element_by_index(driver, context, user_info["clickableIndex"], dbg)

        # Last resort: try any visible non-password input
        if not field:
            try:
                all_vis = driver.find_elements(By.CSS_SELECTOR,
                    'input:not([type="hidden"]):not([type="password"])'
                    ':not([type="checkbox"]):not([type="radio"])'
                    ':not([type="submit"]):not([type="button"])')
                field = next((f for f in all_vis if f.is_displayed()), None)
            except Exception:
                pass

        if field:
            add_step("type", f"LLM: Entering username into {user_info.get('description', 'field')[:60]}")
            try:
                username_entered = robust_type(driver, field, username, dbg)
                random_delay(0.8, 1.5)
            except Exception as e:
                dbg(f"  Failed to type username: {e}")

    # Fill password (if visible on same page)
    if pass_info.get("found"):
        field = None
        css = pass_info.get("cssSelector", "")
        if css:
            try:
                fields = driver.find_elements(By.CSS_SELECTOR, css)
                field = next((f for f in fields if f.is_displayed()), None)
            except Exception:
                pass
        if not field:
            try:
                pw_fields = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
                field = next((f for f in pw_fields if f.is_displayed()), None)
            except Exception:
                pass

        if field:
            add_step("type", "LLM: Entering password")
            try:
                password_entered = robust_type(driver, field, password, dbg)
                random_delay(0.8, 1.5)
            except Exception as e:
                dbg(f"  Failed to type password: {e}")

    # Click submit button
    if submit_info.get("found") and (username_entered or password_entered):
        random_mouse_wander(driver, 2)
        random_delay(0.5, 1.0)
        btn = None

        # Try CSS selector
        css = submit_info.get("cssSelector", "")
        if css:
            try:
                btns = driver.find_elements(By.CSS_SELECTOR, css)
                btn = next((b for b in btns if b.is_displayed()), None)
            except Exception:
                pass

        # Try clickable index
        if not btn and submit_info.get("clickableIndex", -1) >= 0:
            btn = _get_element_by_index(driver, context, submit_info["clickableIndex"], dbg)

        # Try text-based button search
        if not btn:
            btn_text = submit_info.get("text", "")
            if btn_text:
                btn = _find_action_button(driver, [btn_text.lower()])
            if not btn:
                btn = _find_action_button(driver, ["sign in", "log in", "submit", "continue", "next"])

        if btn:
            btn_label = (btn.text or submit_info.get("text", "Submit")).strip()
            add_step("llm_click", f"LLM: Clicking '{btn_label}'")
            human_click(driver, btn)
        else:
            # Try any visible submit button before pressing Enter
            any_btn = _find_any_visible_submit(driver)
            if any_btn:
                add_step("llm_click", f"LLM: Clicking fallback button '{any_btn.text.strip() or 'Submit'}'")
                human_click(driver, any_btn)
            else:
                add_step("press_key", "LLM: No login button found — pressing Enter as last resort")
                from selenium.webdriver.common.keys import Keys
                driver.switch_to.active_element.send_keys(Keys.ENTER)

        if password_entered:
            return "submitted"
        elif username_entered:
            return "username_entered"

    elif username_entered and not password_entered:
        # Username-only step — click continue/next
        btn = _find_action_button(driver, ["continue", "next", "sign in", "log in", "login", "submit"])
        if btn:
            add_step("llm_click", f"LLM: Clicking '{btn.text.strip() or 'Continue'}'")
            human_click(driver, btn)
        else:
            any_btn = _find_any_visible_submit(driver)
            if any_btn:
                add_step("llm_click", f"LLM: Clicking fallback button '{any_btn.text.strip() or 'Continue'}'")
                human_click(driver, any_btn)
            else:
                add_step("press_key", "LLM: No continue button found — pressing Enter as last resort")
                driver.switch_to.active_element.send_keys(Keys.ENTER)
        return "username_entered"

    dbg("  LLM login: could not find or fill any fields")
    return "failed"


def _get_element_by_index(driver, page_context, index, dbg):
    """Get a clickable element by its index in the page context."""
    from selenium.webdriver.common.by import By
    clickables = page_context.get("clickableElements", [])
    if index < 0 or index >= len(clickables):
        return None

    info = clickables[index]
    tag = info.get("tag", "")
    text = info.get("text", "")
    href = info.get("href", "")

    # Try to locate the element
    try:
        if tag and text:
            elements = driver.find_elements(By.CSS_SELECTOR, tag)
            for el in elements:
                if el.is_displayed() and text in (el.text or ""):
                    return el
        if href:
            elements = driver.find_elements(By.CSS_SELECTOR, f'a[href="{href}"]')
            for el in elements:
                if el.is_displayed():
                    return el
    except Exception as e:
        dbg(f"  Could not locate element by index {index}: {e}")
    return None


def _click_element_by_index(driver, page_context, index, dbg):
    """Click a clickable element by its index."""
    el = _get_element_by_index(driver, page_context, index, dbg)
    if el:
        human_click(driver, el)
        return True
    return False


def _do_login(driver, username, password, args, result, add_step, dbg, gemini_key=""):
    """Multi-step login flow. Returns True if login appears successful."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    # Initialize Gemini model for LLM-assisted login if key is available
    llm_model = None
    if gemini_key:
        llm_model = _init_gemini(gemini_key)
        if llm_model:
            dbg("LLM model available for login assistance")

    # ── Wait for ANY input to appear (SPA pages render late) ──
    try:
        dbg("Waiting up to 20s for any input element to appear...")
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR,
                'input:not([type="hidden"])'
            ))
        )
        random_delay(1.0, 2.0)
        dbg("Input element detected on page")
    except Exception:
        dbg("No input found via WebDriverWait, will still try the loop...")
        # Log what's on the page for debugging
        _find_inputs_via_js(driver, dbg)

    for attempt in range(5):
        dbg(f"Login attempt {attempt + 1}")
        random_delay(0.5, 1.0)

        # ── Check for login error banners BEFORE retrying credentials ──
        if attempt > 0:
            err_body = _safe_body_text(driver).lower()
            login_err_kw = ["invalid username", "invalid password", "invalid credentials",
                            "incorrect password", "incorrect username", "wrong password",
                            "authentication failed", "login failed", "unable to sign in",
                            "account locked", "account disabled", "too many attempts",
                            "please check and try again", "does not match"]
            if any(kw in err_body for kw in login_err_kw):
                # Find the actual error message to display
                import re as _re2
                err_msg = ""
                try:
                    err_banners = driver.find_elements(By.CSS_SELECTOR,
                        '[class*="error" i], [class*="alert" i], [role="alert"], '
                        '[class*="invalid" i], [class*="warning" i], .error-message'
                    )
                    for eb in err_banners:
                        if eb.is_displayed() and eb.text.strip():
                            err_msg = eb.text.strip()[:200]
                            break
                except Exception:
                    pass
                if not err_msg:
                    err_msg = "Invalid credentials"
                dbg(f"  Login error detected before retry: {err_msg}")
                add_step("fail", f"{err_msg}")
                result["error"] = f"Login failed: {err_msg}"
                return False

        # ── Primary selectors (common login input attributes) ──
        user_fields = driver.find_elements(By.CSS_SELECTOR,
            'input[type="text"], input[type="email"], '
            'input[name*="user" i], input[name*="email" i], '
            'input[id*="user" i], input[id*="email" i], '
            'input[name*="login" i], input[id*="login" i], '
            'input[placeholder*="user" i], input[placeholder*="name" i], '
            'input[placeholder*="email" i], input[placeholder*="login" i], '
            'input[aria-label*="user" i], input[aria-label*="email" i], '
            'input[aria-label*="login" i], input[autocomplete="username"]'
        )
        pass_fields = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')

        user_fields = [f for f in user_fields if f.is_displayed()]
        pass_fields = [f for f in pass_fields if f.is_displayed()]

        # ── Fallback: if no user fields found, try ANY visible non-password input ──
        if not user_fields and not pass_fields:
            dbg("  Primary selectors missed — trying catch-all input selector")
            all_inputs = driver.find_elements(By.CSS_SELECTOR,
                'input:not([type="hidden"]):not([type="password"])'
                ':not([type="checkbox"]):not([type="radio"])'
                ':not([type="submit"]):not([type="button"])'
                ':not([type="file"]):not([type="image"])'
                ':not([type="reset"]):not([type="search"])'
            )
            user_fields = [f for f in all_inputs if f.is_displayed()]
            dbg(f"  Catch-all found {len(user_fields)} visible inputs")

        # ── Shadow DOM fallback via JavaScript ──
        if not user_fields and not pass_fields:
            dbg("  No inputs via CSS — trying JavaScript shadow DOM traversal")
            js_inputs = _find_inputs_via_js(driver, dbg)
            visible_js = [i for i in js_inputs if i.get("visible")]
            if visible_js:
                # Try to find them via JS and interact
                try:
                    elements = driver.execute_script('''
                        function findInputs(root) {
                            let inputs = Array.from(root.querySelectorAll('input'));
                            root.querySelectorAll('*').forEach(el => {
                                if (el.shadowRoot) inputs.push(...findInputs(el.shadowRoot));
                            });
                            return inputs;
                        }
                        let all = findInputs(document);
                        let visible = all.filter(i =>
                            (i.offsetParent || i.offsetWidth || i.offsetHeight) &&
                            i.type !== 'hidden' && i.type !== 'checkbox' &&
                            i.type !== 'radio' && i.type !== 'submit' &&
                            i.type !== 'button'
                        );
                        let user = visible.filter(i => i.type !== 'password');
                        let pass = visible.filter(i => i.type === 'password');
                        return {user: user, pass: pass};
                    ''')
                    if elements and elements.get("user"):
                        user_fields = elements["user"]
                        dbg(f"  JS found {len(user_fields)} user inputs in shadow DOM")
                    if elements and elements.get("pass"):
                        pass_fields = elements["pass"]
                except Exception as e:
                    dbg(f"  JS element extraction failed: {e}")

        has_user = len(user_fields) > 0
        has_pass = len(pass_fields) > 0
        dbg(f"  username_visible={has_user}, password_visible={has_pass}")

        # ── A) Username step (no password yet) ────────────
        if has_user and not has_pass:
            field = user_fields[0]
            label = field.get_attribute("name") or field.get_attribute("id") or "text"
            add_step("type", f"Typing username into [{label}]")
            filled = robust_type(driver, field, username, dbg)
            if not filled:
                dbg(f"  WARNING: Username field [{label}] may not have been filled!")
            random_delay(1.0, 2.0)
            random_mouse_wander(driver, 2)
            random_delay(0.5, 1.0)

            # Always try to click the login/continue button — never just press Enter
            btn = _find_action_button(driver, ["continue", "next", "sign in", "log in", "login", "submit", "suivant", "connexion"])
            if not btn:
                dbg("  No named button found — looking for any visible button")
                btn = _find_any_visible_submit(driver)

            if btn:
                btn_label = (btn.text or "").strip() or "Continue"
                pre_click_url = driver.current_url
                add_step("click", f"Clicking '{btn_label}'")
                human_click(driver, btn)
                random_delay(2.0, 3.0)

                # If page didn't change, fallback to JS click
                post_click_url = driver.current_url
                if post_click_url == pre_click_url:
                    dbg("  Page didn't change after click — trying JS .click()")
                    try:
                        driver.execute_script("arguments[0].click()", btn)
                    except Exception:
                        pass
            else:
                add_step("press_key", "No login button found — pressing Enter as last resort")
                field.send_keys(Keys.ENTER)

            random_delay(3.0, 6.0)
            try:
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, 'input[type="password"]'))
                )
                random_delay(1.0, 2.5)
            except Exception:
                body_text = _safe_body_text(driver)
                if "RC01" in body_text or "error" in body_text.lower()[:500]:
                    add_step("fail", f"Blocked: {body_text[:200]}")
                    result["error"] = f"Login blocked: {body_text[:500]}"
                    return False
                dbg("Password field not yet visible, retrying...")
            continue

        # ── B) Password visible ───────────────────────────
        if has_pass:
            if has_user:
                uf = user_fields[0]
                if not (uf.get_attribute("value") or "").strip():
                    add_step("type", "Entering username")
                    filled = robust_type(driver, uf, username, dbg)
                    if not filled:
                        dbg("  WARNING: Username field may not have been filled!")
                    random_delay(0.8, 1.5)

            pf = pass_fields[0]
            add_step("type", "Entering password")
            filled = robust_type(driver, pf, password, dbg)
            if not filled:
                dbg("  WARNING: Password field may not have been filled!")
            random_delay(1.0, 2.0)
            random_mouse_wander(driver, 2)
            random_delay(0.5, 1.0)

            # ── PRE-SUBMIT: Verify fields still have values (page JS might clear them) ──
            if has_user:
                uf_val = (user_fields[0].get_attribute("value") or "").strip()
                if not uf_val:
                    dbg("  Username field was CLEARED by page — re-typing")
                    robust_type(driver, user_fields[0], username, dbg)
                    random_delay(0.5, 1.0)
                else:
                    dbg(f"  Username field verified: {len(uf_val)} chars")
            pf_val = (pf.get_attribute("value") or "").strip()
            if not pf_val:
                dbg("  Password field was CLEARED by page — re-typing")
                robust_type(driver, pf, password, dbg)
                random_delay(0.5, 1.0)
            else:
                dbg(f"  Password field verified: {len(pf_val)} chars")

            # Always try to click the login/sign-in button — do NOT press Enter
            btn = _find_action_button(driver, ["sign in", "log in", "login", "submit", "continue", "connexion", "se connecter"])
            if not btn:
                dbg("  No named login button found — looking for any submit button")
                btn = _find_any_visible_submit(driver)

            if btn:
                btn_id = btn.get_attribute("id") or ""
                btn_label = (btn.text or "").strip() or "Sign In"
                pre_click_url = driver.current_url
                dbg(f"  Found button: tag={btn.tag_name}, id='{btn_id}', text='{btn_label}'")
                add_step("click", f"Clicking '{btn_label}'")
                human_click(driver, btn)
                random_delay(3.0, 5.0)

                # Check if page actually changed — if not, the JS handler might not have fired
                post_click_url = driver.current_url
                still_pass = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
                still_pass = [f for f in still_pass if f.is_displayed()]
                if post_click_url == pre_click_url and still_pass:
                    dbg("  Page didn't change after human_click — trying JS .click()")
                    try:
                        driver.execute_script("arguments[0].click()", btn)
                        random_delay(3.0, 5.0)
                    except Exception:
                        pass

                    # Check again
                    post_js_url = driver.current_url
                    still_pass2 = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
                    still_pass2 = [f for f in still_pass2 if f.is_displayed()]
                    if post_js_url == pre_click_url and still_pass2:
                        # Try jQuery trigger (for externally-bound handlers like ASP.NET + jQuery)
                        dbg("  JS click also didn't work — trying jQuery trigger")
                        try:
                            driver.execute_script("""
                                if (typeof jQuery !== 'undefined') {
                                    jQuery(arguments[0]).trigger('click');
                                } else if (typeof $ !== 'undefined') {
                                    $(arguments[0]).trigger('click');
                                }
                            """, btn)
                            random_delay(3.0, 5.0)
                        except Exception:
                            pass

                        # Last check before form.submit() fallback
                        post_jq_url = driver.current_url
                        still_pass3 = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
                        still_pass3 = [f for f in still_pass3 if f.is_displayed()]
                        if post_jq_url == pre_click_url and still_pass3:
                            dbg("  All click methods failed — trying form.submit()")
                            try:
                                driver.execute_script("""
                                    var form = document.querySelector('form');
                                    if (form) form.submit();
                                """)
                                add_step("submit", "Submitted login form via JavaScript")
                            except Exception:
                                dbg("  form.submit() failed, pressing Enter")
                                pf.send_keys(Keys.ENTER)
            else:
                # No button found at all
                dbg("  No button found — trying form.submit() via JS")
                try:
                    submitted = driver.execute_script("""
                        var form = document.querySelector('form');
                        if (form) { form.submit(); return true; }
                        return false;
                    """)
                    if submitted:
                        add_step("submit", "Submitted form via JavaScript")
                    else:
                        add_step("press_key", "No form found — pressing Enter as last resort")
                        pf.send_keys(Keys.ENTER)
                except Exception:
                    pf.send_keys(Keys.ENTER)

            random_delay(5.0, 8.0)
            add_step("wait", "Login submitted, waiting for portal")

            # ── Verify login was successful ──
            pre_url = driver.current_url
            random_delay(2.0, 3.0)
            post_body = _safe_body_text(driver).lower()
            post_url = driver.current_url

            # Check for login error messages
            login_errors = ["invalid password", "invalid username", "invalid credentials",
                            "incorrect", "try again", "please check",
                            "authentication failed", "wrong password",
                            "login failed", "unable to sign in",
                            "account locked", "does not match",
                            "account disabled", "too many attempts"]
            if any(err in post_body for err in login_errors):
                dbg(f"  Login error detected after submit")
                add_step("fail", "Login failed: error message on page")
                result["error"] = f"Login failed: credentials may be incorrect"
                return False

            # Check if password field is still visible (login didn't work)
            still_pass = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
            still_pass = [f for f in still_pass if f.is_displayed()]
            if still_pass and pre_url == post_url:
                dbg(f"  Password field still visible after submit, login may have failed")
                # Don't return False yet — some sites show password briefly during transition
                random_delay(3.0, 5.0)
                still_pass2 = driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]')
                still_pass2 = [f for f in still_pass2 if f.is_displayed()]
                if still_pass2:
                    dbg(f"  Password field still visible after extra wait — login failed")
                    add_step("fail", "Login failed: still on login page")
                    result["error"] = "Login failed: still on login page after submit"
                    return False

            return True

        # ── C) No fields — maybe iframe, shadow DOM, or already logged in ─
        if not has_user and not has_pass:
            # Try iframes first
            iframes = driver.find_elements(By.TAG_NAME, "iframe")
            switched = False
            for iframe in iframes:
                try:
                    driver.switch_to.frame(iframe)
                    if driver.find_elements(By.CSS_SELECTOR, 'input[type="text"], input[type="email"], input[type="password"], input:not([type="hidden"])'):
                        add_step("navigate", "Switched to login iframe")
                        switched = True
                        break
                    driver.switch_to.default_content()
                except Exception:
                    driver.switch_to.default_content()

            if not switched:
                body = _safe_body_text(driver)
                if any(kw in body.lower() for kw in ["account", "dashboard", "billing", "overview", "my rogers"]):
                    add_step("done", "Appears already logged in")
                    return True

                # Try clicking on visible text that looks like a login field (some SPAs use custom elements)
                if attempt <= 2:
                    dbg(f"  No inputs yet (attempt {attempt + 1}), waiting for SPA to render...")
                    random_delay(3.0, 5.0)
                elif attempt == 3:
                    # Try focusing via JavaScript
                    dbg("  Trying JS focus/click on first focusable element...")
                    try:
                        driver.execute_script('''
                            let el = document.querySelector('input, [contenteditable="true"], [role="textbox"]');
                            if (el) { el.focus(); el.click(); }
                        ''')
                        random_delay(1.0, 2.0)
                    except Exception:
                        pass
                elif attempt == 4:
                    # ── LLM-ASSISTED LOGIN: Ask Gemini to find the form ──
                    if llm_model:
                        dbg("  Trying LLM-assisted login...")
                        add_step("llm", "Using LLM to analyze login page")
                        llm_login_result = _llm_assisted_login(
                            driver, llm_model, username, password, add_step, dbg
                        )
                        if llm_login_result == "submitted":
                            random_delay(5.0, 8.0)
                            add_step("wait", "LLM login submitted, waiting for portal")
                            return True
                        elif llm_login_result == "username_entered":
                            dbg("  LLM entered username, waiting for password field...")
                            random_delay(3.0, 6.0)
                            continue  # Loop back to detect password field
                        else:
                            dbg("  LLM login did not succeed, trying refresh...")
                    # Fallback: page refresh
                    dbg("  Refreshing page to retry form render...")
                    add_step("navigate", "Refreshing page (form not rendering)")
                    driver.refresh()
                    random_delay(4.0, 7.0)
                    random_mouse_wander(driver)
                    random_delay(1.0, 2.0)
                elif attempt == 5:
                    # Second LLM attempt after refresh
                    if llm_model:
                        dbg("  Second LLM login attempt after refresh...")
                        add_step("llm", "LLM retry: analyzing login page after refresh")
                        llm_login_result = _llm_assisted_login(
                            driver, llm_model, username, password, add_step, dbg
                        )
                        if llm_login_result == "submitted":
                            random_delay(5.0, 8.0)
                            add_step("wait", "LLM login submitted, waiting for portal")
                            return True
                        elif llm_login_result == "username_entered":
                            random_delay(3.0, 6.0)
                            continue
                elif attempt >= 6:
                    add_step("fail", "No login fields found after multiple attempts")
                    result["error"] = "Could not find login form"
                    return False

            random_delay(2.0, 4.0)

    return False


def _post_login_settle(driver, add_step, dbg):
    """After login/2FA, wait for page to settle, dismiss popups, handle stuck pages."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys

    dbg("Post-login settle: waiting for page transition...")
    random_delay(3.0, 5.0)

    for check in range(3):
        body = _safe_body_text(driver)
        url = driver.current_url
        dbg(f"  Post-login check {check + 1}: url={url[:80]}, body_len={len(body)}")

        # ── Dismiss overlay popups (feedback, save password, cookie consent, etc.) ──
        dismiss_keywords = [
            "no thanks", "not now", "skip", "dismiss", "close", "maybe later",
            "remind me later", "don't save", "never", "cancel",
        ]
        try:
            # Try ESC key first to dismiss any overlay
            from selenium.webdriver.common.action_chains import ActionChains
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            random_delay(0.5, 1.0)
        except Exception:
            pass

        # Click dismiss-type buttons
        dismissed = False
        try:
            all_btns = driver.find_elements(By.CSS_SELECTOR,
                'button, a[role="button"], [role="button"], input[type="button"]'
            )
            for btn in all_btns:
                try:
                    if not btn.is_displayed():
                        continue
                    txt = (btn.text or btn.get_attribute("aria-label") or "").strip().lower()
                    if any(kw in txt for kw in dismiss_keywords):
                        dbg(f"  Dismissing popup: '{txt}'")
                        add_step("click", f"Dismissing popup: '{txt}'")
                        human_click(driver, btn)
                        random_delay(2.0, 3.0)
                        dismissed = True
                        break
                except Exception:
                    continue
        except Exception:
            pass

        # ── Close any modal overlays via close/X buttons ──
        if not dismissed:
            try:
                close_btns = driver.find_elements(By.CSS_SELECTOR,
                    '[aria-label*="close" i], [aria-label*="dismiss" i], '
                    '.close, .modal-close, [data-dismiss="modal"], '
                    'button.close-btn, .overlay-close'
                )
                for cb in close_btns:
                    try:
                        if cb.is_displayed():
                            dbg(f"  Clicking close/X button")
                            human_click(driver, cb)
                            random_delay(1.0, 2.0)
                            dismissed = True
                            break
                    except Exception:
                        continue
            except Exception:
                pass

        # ── Check if we're on a real portal page now ──
        body = _safe_body_text(driver)
        lower = body.lower()

        # First check if login fields are STILL visible — means login failed
        still_login = False
        try:
            login_fields = driver.find_elements(By.CSS_SELECTOR,
                'input[type="password"], input[type="text"][name*="user" i], '
                'input[type="email"], input[autocomplete="username"]'
            )
            visible_login = [f for f in login_fields if f.is_displayed()]
            if visible_login:
                still_login = True
                dbg(f"  Login fields still visible ({len(visible_login)} fields) — login may have failed")
        except Exception:
            pass

        # Check for login error messages
        login_error_keywords = ["invalid password", "incorrect", "try again",
                                "authentication failed", "wrong password",
                                "invalid credentials", "login failed"]
        if any(kw in lower for kw in login_error_keywords):
            dbg(f"  Login error message detected on page")
            still_login = True

        portal_keywords = ["dashboard", "billing", "overview",
                           "my rogers", "usage", "balance", "payment", "plan",
                           "my account", "account overview"]
        # Only treat as portal if NOT still showing login fields AND page has real content
        if not still_login and any(kw in lower for kw in portal_keywords):
            # SPA pages (Rogers, etc.) may show portal keywords in a skeleton
            # with very little body text. Wait briefly but don't loop forever.
            if len(body) < 500 and check < 2:
                dbg(f"  Portal keywords found but body very short ({len(body)} chars) — waiting briefly")
                random_delay(3.0, 5.0)
                body = _safe_body_text(driver)
                lower = body.lower()
                dbg(f"  After extra wait: body_len={len(body)}")
                if len(body) < 500:
                    continue

            dbg("  Reached portal/account page")
            add_step("done", "Portal page loaded after login")
            return

        # ── Still on feedback/verification/loading page — try reloading ──
        if check == 1:
            dbg("  Page seems stuck, trying page reload...")
            add_step("navigate", "Reloading page (stuck after login)")
            driver.refresh()
            random_delay(4.0, 6.0)
        elif check == 2:
            # Try navigating to the account overview directly
            base_url = url.split("#")[0].split("?")[0]
            if "rogers" in base_url.lower():
                target = "https://www.rogers.com/web/totes/#/overview"
            else:
                target = base_url
            dbg(f"  Navigating directly to: {target}")
            add_step("navigate", f"Going to account overview: {target}")
            driver.get(target)
            random_delay(4.0, 6.0)

        random_delay(2.0, 3.0)

    dbg("  Post-login settle: proceeding after max checks")


def _detect_2fa_page(body_text, driver):
    """Check if the current page is a 2FA / verification code page.
    Requires BOTH keyword match AND a visible code input field to avoid
    false positives from reCAPTCHA or login validation text."""
    from selenium.webdriver.common.by import By
    lower = body_text.lower()

    # Exclude pages that mention captcha/recaptcha — those are NOT 2FA
    captcha_indicators = ["recaptcha", "captcha", "i'm not a robot", "i am not a robot"]
    if any(ci in lower for ci in captcha_indicators):
        # Only proceed if there are STRONG 2FA signals alongside captcha
        pass  # fall through to keyword + field check below

    tfa_keywords = [
        "verification code", "verify your identity", "two-factor",
        "2-step verification", "security code", "one-time code",
        "receive a code", "receive verification", "enter the code",
        "we sent a code", "confirm your identity", "multi-factor",
        "enter code", "code sent", "we texted", "we emailed",
    ]
    has_keyword = any(kw in lower for kw in tfa_keywords)
    if not has_keyword:
        return False

    # Verify there's actually a code input field visible (short text/number input)
    # A real 2FA page has a visible input for the verification code
    try:
        # Look for visible text/number/tel inputs that could be code fields
        code_inputs = driver.find_elements(By.CSS_SELECTOR,
            'input[type="text"], input[type="number"], input[type="tel"], '
            'input[inputmode="numeric"], input[autocomplete="one-time-code"]'
        )
        visible_code = []
        for inp in code_inputs:
            if not inp.is_displayed():
                continue
            # Skip if it looks like a username/email/password/search field
            name = (inp.get_attribute("name") or "").lower()
            inp_id = (inp.get_attribute("id") or "").lower()
            inp_type = (inp.get_attribute("type") or "").lower()
            placeholder = (inp.get_attribute("placeholder") or "").lower()
            skip_names = ["user", "email", "login", "search", "password", "captcha"]
            if any(s in name or s in inp_id or s in placeholder for s in skip_names):
                continue
            # If it's a password field, skip
            if inp_type == "password":
                continue
            visible_code.append(inp)

        if not visible_code:
            # No code input found — probably not a real 2FA page
            # Could be reCAPTCHA text or ASP.NET validation text
            return False
    except Exception:
        # If we can't check inputs, be conservative and rely on keywords only
        # with stricter keyword matching
        strict_keywords = ["verification code", "2-step verification", "two-factor",
                          "we sent a code", "enter the code", "one-time code"]
        return any(kw in lower for kw in strict_keywords)

    return True


def _click_2fa_channel(driver, add_step, dbg, prefer="text"):
    """Click the preferred 2FA delivery option (text/email).
    Falls back to the other channel if preferred is not found.
    Returns description of the channel selected."""
    from selenium.webdriver.common.by import By

    # Try preferred channel first, then the other
    channels_to_try = ["text", "email"] if prefer == "text" else ["email", "text"]

    for channel in channels_to_try:
        candidates = []
        for sel in ["button", "a", "div[role='button']", "label", "li", "span"]:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
            for el in els:
                if not el.is_displayed():
                    continue
                txt = (el.text or "").strip()
                lower = txt.lower()
                if channel == "text" and ("text" in lower or "sms" in lower):
                    candidates.append((el, txt))
                elif channel == "email" and "email" in lower:
                    candidates.append((el, txt))

        # Also check radio buttons / input labels
        radios = driver.find_elements(By.CSS_SELECTOR, 'input[type="radio"]')
        for radio in radios:
            if not radio.is_displayed():
                continue
            try:
                parent = radio.find_element(By.XPATH, "..")
                txt = (parent.text or "").strip()
                lower = txt.lower()
                if channel == "text" and ("text" in lower or "sms" in lower):
                    candidates.append((radio, txt))
                elif channel == "email" and "email" in lower:
                    candidates.append((radio, txt))
            except Exception:
                pass

        if candidates:
            el, txt = candidates[0]
            if channel != channels_to_try[0]:
                dbg(f"Preferred channel '{channels_to_try[0]}' not found, falling back to '{channel}'")
            add_step("click", f"Selecting 2FA channel: {txt}")
            human_click(driver, el)
            random_delay(1.0, 2.0)

            # Look for a Send/Continue/Submit button after selecting
            btn = _find_action_button(driver, ["send", "continue", "next", "submit", "receive", "get code"])
            if btn:
                add_step("click", f"Clicking '{btn.text.strip() or 'Send'}'")
                human_click(driver, btn)
            return txt

    # No channel options found at all — try clicking any send button
    dbg("No text or email channel option found, looking for any send button")
    try:
        btn = _find_action_button(driver, ["send", "text me", "get code", "continue"])
        if btn:
            channel_desc = btn.text.strip() or "Send Code"
            add_step("click", f"Clicking '{channel_desc}'")
            human_click(driver, btn)
            return channel_desc
    except Exception as e:
        dbg(f"2FA channel selection error: {e}")

    return "Unknown"


def _save_session(driver, original_url):
    """Save cookies and current URL to a temp file for 2FA resume."""
    session_data = {
        "cookies": driver.get_cookies(),
        "url": driver.current_url,
        "original_url": original_url,
    }
    fd, path = tempfile.mkstemp(prefix="nestmind_2fa_", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(session_data, f)
    return path


def _find_any_visible_submit(driver):
    """Find ANY visible button/submit element on the page — last resort fallback.
    Returns the most likely submit button even if we can't match keywords."""
    from selenium.webdriver.common.by import By

    # Try any visible <button> that's not obviously a close/cancel button
    skip_texts = {"close", "cancel", "dismiss", "x", "no", "×"}
    all_btns = driver.find_elements(By.CSS_SELECTOR,
        'button, input[type="submit"], [role="button"]')
    for btn in all_btns:
        if not btn.is_displayed():
            continue
        txt = (btn.text or "").lower().strip()
        if txt in skip_texts:
            continue
        # Prefer buttons that are inside a form
        try:
            parent_form = btn.find_element(By.XPATH, "ancestor::form")
            if parent_form:
                return btn
        except Exception:
            pass
    # If no form-contained button, return the first visible non-skip button
    for btn in all_btns:
        if not btn.is_displayed():
            continue
        txt = (btn.text or "").lower().strip()
        if txt not in skip_texts:
            return btn
    return None


def _find_action_button(driver, keywords):
    """Find a visible button whose text or aria-label matches any keyword (case-insensitive).
    Searches: submit inputs, <button>, div/span[role=button], <a> styled as buttons,
    form submit elements, and aria-label matching."""
    from selenium.webdriver.common.by import By

    # 1. Explicit submit inputs inside forms
    for sel in ['button[type="submit"]', 'input[type="submit"]', 'input[type="button"]']:
        btns = driver.find_elements(By.CSS_SELECTOR, sel)
        for b in btns:
            if not b.is_displayed():
                continue
            # For input[type="button"], check value against keywords
            val = (b.get_attribute("value") or b.text or "").lower().strip()
            if any(kw in val for kw in keywords):
                return b
        # For submit buttons without keyword check (first match), only if type=submit
        visible = [b for b in btns if b.is_displayed()]
        if visible and sel in ['button[type="submit"]', 'input[type="submit"]']:
            return visible[0]

    # 2. Scan <button> elements by text or aria-label
    all_btns = driver.find_elements(By.TAG_NAME, "button")
    for btn in all_btns:
        if not btn.is_displayed():
            continue
        txt = (btn.text or "").lower().strip()
        aria = (btn.get_attribute("aria-label") or "").lower().strip()
        val = (btn.get_attribute("value") or "").lower().strip()
        if any(kw in txt or kw in aria or kw in val for kw in keywords):
            return btn

    # 3. div/span with role="button" (common in SPAs like Rogers, Google)
    role_btns = driver.find_elements(By.CSS_SELECTOR,
        'div[role="button"], span[role="button"], a[role="button"]')
    for btn in role_btns:
        if not btn.is_displayed():
            continue
        txt = (btn.text or "").lower().strip()
        aria = (btn.get_attribute("aria-label") or "").lower().strip()
        if any(kw in txt or kw in aria for kw in keywords):
            return btn

    # 4. <a> tags styled as buttons
    links = driver.find_elements(By.CSS_SELECTOR,
        'a.btn, a.button, a[class*="btn"], a[class*="login"], a[class*="sign"]')
    for link in links:
        if not link.is_displayed():
            continue
        txt = (link.text or "").lower().strip()
        if any(kw in txt for kw in keywords):
            return link

    # 5. Generic clickable elements with matching id/class
    for kw in keywords:
        kw_clean = kw.replace(" ", "")
        for sel in [
            f'[id*="{kw_clean}" i]',
            f'[class*="{kw_clean}" i]',
            f'[data-testid*="{kw_clean}" i]',
        ]:
            try:
                els = driver.find_elements(By.CSS_SELECTOR, sel)
                for el in els:
                    if el.is_displayed() and el.tag_name in ("button", "a", "div", "span", "input"):
                        return el
            except Exception:
                continue

    return None


def _safe_body_text(driver):
    """Get page body text safely, including Shadow DOM content for SPA pages."""
    try:
        # First try JS innerText which includes more rendered content
        text = driver.execute_script("""
            // Traverse shadow DOMs to get all text
            function getAllText(root) {
                var text = '';
                if (root.innerText) text += root.innerText;
                root.querySelectorAll('*').forEach(function(el) {
                    if (el.shadowRoot) {
                        text += ' ' + getAllText(el.shadowRoot);
                    }
                });
                return text;
            }
            return getAllText(document.body);
        """) or ""
        if len(text) > 100:
            return text
    except Exception:
        pass
    # Fallback to simple body.text
    try:
        from selenium.webdriver.common.by import By
        return driver.find_element(By.TAG_NAME, "body").text or ""
    except Exception:
        return ""


def _try_navigate_to_billing(driver, add_step):
    """After login, try to find and click a billing/account link."""
    from selenium.webdriver.common.by import By
    try:
        links = driver.find_elements(By.TAG_NAME, "a")
        for link in links:
            if not link.is_displayed():
                continue
            txt = (link.text or "").lower()
            if any(kw in txt for kw in ["bill", "billing", "account", "overview", "payment", "facture"]):
                add_step("click", f"Navigating to '{link.text.strip()}'")
                human_click(driver, link)
                random_delay(3.0, 5.0)
                return
    except Exception:
        pass


if __name__ == "__main__":
    main()
