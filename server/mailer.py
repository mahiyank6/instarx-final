"""Email delivery for InstaRX verification codes.

Delivery is pluggable on purpose:

  * If SMTP credentials are present in the environment, codes are emailed for
    real over TLS.
  * If they are not, we fall back to DEV mode - the code is printed to the
    server console and handed back to the browser so the project still
    demonstrates end to end without an email account.

Configure real sending by setting these before starting the server:

    SMTP_HOST   e.g. smtp.gmail.com
    SMTP_PORT   e.g. 587
    SMTP_USER   the full sending address
    SMTP_PASS   an app password (never your main account password)
    SMTP_FROM   optional display sender, defaults to SMTP_USER

Nothing else in the app changes when you switch it on.
"""
import os
import smtplib
import ssl
from email.message import EmailMessage

SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASS = os.environ.get("SMTP_PASS")
SMTP_FROM = os.environ.get("SMTP_FROM") or SMTP_USER

SMTP_READY = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)


def _body(name, code, purpose):
    lead = {
        "signup": "Welcome to InstaRX. Confirm your email to finish creating your account.",
        "login": "Here is the code to confirm it is really you signing in.",
    }.get(purpose, "Here is your InstaRX verification code.")

    text = (
        f"Hi {name},\n\n{lead}\n\n"
        f"    Your code is: {code}\n\n"
        "It expires in 15 minutes. If you did not request this, ignore this email.\n\n"
        "- InstaRX\n"
        "(This is a student project, not a licensed pharmacy.)\n"
    )

    html = f"""\
<div style="font-family:Segoe UI,Arial,sans-serif;background:#F2FAFD;padding:28px;">
  <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:16px;
              overflow:hidden;border:1px solid #DCEEF7;">
    <div style="background:#03045E;padding:20px 26px;">
      <span style="color:#fff;font-size:21px;font-weight:800;">Insta<span style="color:#00B4D8;">RX</span></span>
    </div>
    <div style="padding:26px;">
      <p style="margin:0 0 6px;color:#0A1B2A;font-size:15px;">Hi {name},</p>
      <p style="margin:0 0 20px;color:#5E7183;font-size:14px;line-height:1.6;">{lead}</p>
      <div style="background:#F2FAFD;border:1.5px dashed #00B4D8;border-radius:12px;
                  padding:18px;text-align:center;margin-bottom:20px;">
        <div style="font-size:12px;color:#5E7183;margin-bottom:8px;">Your verification code</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:7px;color:#03045E;">{code}</div>
      </div>
      <p style="margin:0;color:#5E7183;font-size:12.5px;line-height:1.6;">
        This code expires in 15 minutes. If you did not request it, you can safely ignore this email.
      </p>
    </div>
    <div style="padding:14px 26px;border-top:1px solid #DCEEF7;color:#8FA6B6;font-size:11px;">
      InstaRX is a student project and not a licensed pharmacy.
    </div>
  </div>
</div>"""
    return text, html


def send_code(to_email, name, code, purpose="signup"):
    """Returns (delivered, dev_code).

    delivered - True when a real email went out.
    dev_code  - the code when running without SMTP, so the UI can display it.
    """
    text, html = _body(name or "there", code, purpose)

    if not SMTP_READY:
        print(f"\n[mailer] DEV MODE - no SMTP configured.")
        print(f"[mailer] Verification code for {to_email}: {code}\n")
        return False, code

    msg = EmailMessage()
    msg["Subject"] = f"{code} is your InstaRX verification code"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.starttls(context=ctx)
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        print(f"[mailer] Verification code emailed to {to_email}")
        return True, None
    except Exception as e:
        # Never let a mail failure lose the signup - fall back to dev delivery.
        print(f"[mailer] SMTP send failed ({e}); falling back to on-screen code.")
        return False, code
