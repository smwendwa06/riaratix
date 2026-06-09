const nodemailer = require('nodemailer');
require('dotenv').config();
 
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});
 
async function sendOTPEmail(to, full_name, otp, type = 'verify') {
  const isReset = type === 'reset';
  const firstName = full_name.split(' ')[0];
 
  const subject = isReset
    ? 'RiaraTix — Reset your password'
    : 'RiaraTix — Verify your email';
 
  const bodyHeading = isReset
    ? 'Reset your password'
    : 'Verify your email';
 
  const bodyIntro = isReset
    ? `We received a request to reset your RiaraTix password. Enter the code below to continue. This code expires in <strong>10 minutes</strong>.`
    : `Welcome to RiaraTix! Enter the verification code below to complete your registration. This code expires in <strong>10 minutes</strong>.`;
 
  const codeLabel = isReset ? 'Your password reset code' : 'Your verification code';
 
  const footer = isReset
    ? `If you didn't request a password reset, you can safely ignore this email. Your password will not change.`
    : `If you didn't create a RiaraTix account, you can safely ignore this email.`;
 
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f2ec;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
          <tr><td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
              <tr>
                <td style="background:#0F6E56;padding:32px;text-align:center;">
                  <div style="font-size:32px;margin-bottom:8px;">${isReset ? '🔑' : '🎓'}</div>
                  <div style="font-family:Georgia,serif;font-size:24px;color:#ffffff;">RiaraTix</div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px;">${bodyHeading}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:36px 32px;">
                  <p style="font-size:16px;color:#1a1a18;margin:0 0 8px;">Hi ${firstName},</p>
                  <p style="font-size:14px;color:#6b6b66;line-height:1.7;margin:0 0 28px;">
                    ${bodyIntro}
                  </p>
                  <div style="background:#E1F5EE;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;border:1px solid #a8dcc8;">
                    <div style="font-size:13px;color:#0F6E56;font-weight:500;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em;">${codeLabel}</div>
                    <div style="font-size:42px;font-weight:700;color:#0F6E56;letter-spacing:12px;">${otp}</div>
                  </div>
                  <p style="font-size:13px;color:#6b6b66;line-height:1.6;margin:0;">
                    ${footer}
                  </p>
                </td>
              </tr>
              <tr>
                <td style="background:#f4f2ec;padding:20px 32px;border-top:1px solid rgba(0,0,0,0.08);">
                  <p style="font-size:12px;color:#6b6b66;margin:0;text-align:center;">
                    © 2026 RiaraTix · Built for Riara University<br/>
                    This is an automated email, please do not reply.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };
  await transporter.sendMail(mailOptions);
}
 
async function sendReminderEmail(to, full_name, { ticketId, eventTitle, tierName, amount, minsLeft, label, expiresAt, expired = false, confirmed = false }) {
  const firstName = full_name.split(' ')[0];
  const fmt = (n) => Number(n).toLocaleString();
  const expiryStr = expiresAt ? new Date(expiresAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
  const expiryDateStr = expiresAt ? new Date(expiresAt).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
 
  // Mirror bell logic: <=30 mins = urgent (warning), >30 mins = info
  const isUrgent = !confirmed && !expired && minsLeft <= 30;
 
  // Subject — matches bell title wording exactly
  const subject = confirmed
    ? `RiaraTix — Your ticket is reserved! Pay within 2 hours`
    : expired
    ? `RiaraTix — Your ticket reservation has expired`
    : isUrgent
    ? `RiaraTix — ⚠️ Your ticket is expiring soon!`
    : `RiaraTix — 🕐 Ticket expiring in ${label}`;
 
  // Icon + colour — matches bell notif-icon types
  const icon = confirmed ? '🎟️' : expired ? '⏰' : isUrgent ? '⚠️' : '🕐';
  const headerBg = confirmed ? '#0F6E56' : expired ? '#C0392B' : isUrgent ? '#C0832A' : '#0F6E56';
 
  // Body text — mirrors bell desc wording
  const bodyText = confirmed
    ? `You've successfully reserved a <strong>${tierName}</strong> ticket for <strong>${eventTitle}</strong>! Your spot is held until <strong>${expiryDateStr} at ${expiryStr}</strong>. Complete your M-Pesa payment before then to confirm your ticket.`
    : expired
    ? `Your reserved <strong>${tierName}</strong> ticket for <strong>${eventTitle}</strong> has expired because payment was not completed in time. The spot has been released back to the pool.`
    : isUrgent
    ? `Your unpaid <strong>${tierName}</strong> ticket for <strong>${eventTitle}</strong> will be cancelled in about <strong>${label}</strong>. Tap the button below to pay now and keep your spot.`
    : `Your unpaid <strong>${tierName}</strong> ticket for <strong>${eventTitle}</strong> will be cancelled in about <strong>${label}</strong>. Complete payment before <strong>${expiryDateStr} at ${expiryStr}</strong>.`;
 
  const ctaText = expired ? null : `Pay Now — KSh ${fmt(amount)}`;
  const footer = confirmed
    ? `You will receive reminder emails at ~90, ~60, and ~30 minutes before your reservation expires.`
    : expired
    ? `If you still want to attend, you can reserve a new ticket on RiaraTix.`
    : `Complete your M-Pesa payment of KSh ${fmt(amount)} to secure your spot.`;
 
  const headerLabel = confirmed ? 'Reservation confirmed' : expired ? 'Reservation expired' : isUrgent ? 'Expiring soon!' : 'Payment reminder';
 
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f2ec;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
          <tr><td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
              <tr>
                <td style="background:${headerBg};padding:28px 32px;text-align:center;">
                  <div style="font-size:32px;margin-bottom:8px;">${icon}</div>
                  <div style="font-family:Georgia,serif;font-size:22px;color:#ffffff;">RiaraTix</div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">${headerLabel}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="font-size:16px;color:#1a1a18;margin:0 0 8px;">Hi ${firstName},</p>
                  <p style="font-size:14px;color:#6b6b66;line-height:1.7;margin:0 0 24px;">${bodyText}</p>
 
                  <div style="background:#f4f2ec;border-radius:12px;padding:20px;margin-bottom:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:8px;">EVENT</td>
                        <td style="font-size:12px;font-weight:600;color:#1a1a18;text-align:right;padding-bottom:8px;">${eventTitle}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:8px;">TIER</td>
                        <td style="font-size:12px;font-weight:600;color:#1a1a18;text-align:right;padding-bottom:8px;">${tierName}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:${expired ? '0' : '8px'};">AMOUNT</td>
                        <td style="font-size:14px;font-weight:700;color:#0F6E56;text-align:right;padding-bottom:${expired ? '0' : '8px'};">KSh ${fmt(amount)}</td>
                      </tr>
                      ${!expired && expiresAt ? `
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;">EXPIRES</td>
                        <td style="font-size:12px;font-weight:600;color:${minsLeft <= 30 ? '#C0832A' : '#1a1a18'};text-align:right;">${expiryDateStr} at ${expiryStr}</td>
                      </tr>` : ''}
                    </table>
                  </div>
 
                  ${!expired ? `
                  <div style="text-align:center;margin-bottom:24px;">
                    <a href="${process.env.FRONTEND_URL}/wallet.html?ticket_id=${ticketId}&action=pay"
                       style="background:${headerBg};color:#fff;border-radius:10px;padding:14px 24px;font-size:15px;font-weight:600;display:inline-block;text-decoration:none;">
                      ${ctaText}
                    </a>
                    <p style="font-size:11px;color:#6b6b66;margin-top:8px;">Opens RiaraTix → My Tickets</p>
                  </div>` : ''}
 
                  <p style="font-size:13px;color:#6b6b66;line-height:1.6;margin:0;">${footer}</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f4f2ec;padding:16px 32px;border-top:1px solid rgba(0,0,0,0.08);">
                  <p style="font-size:12px;color:#6b6b66;margin:0;text-align:center;">
                    © 2026 RiaraTix · Built for Riara University<br/>
                    This is an automated message, please do not reply.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}
 
 
async function sendOrganizerEmail(to, full_name, { type, clubName, reason }) {
  const firstName = full_name.split(' ')[0];
 
  const configs = {
    submitted: {
      subject: 'RiaraTix — Organizer application received',
      icon: '📋',
      headerBg: '#0F6E56',
      headerLabel: 'Application received',
      bodyText: `We've received your application to become an organizer on RiaraTix with the club/society name <strong>${clubName}</strong>. Our admin team will review your application and get back to you shortly.`,
      footer: 'You will receive an email once your application has been reviewed.',
      cta: null,
    },
    approved: {
      subject: 'RiaraTix — Your organizer application is approved! 🎉',
      icon: '✅',
      headerBg: '#0F6E56',
      headerLabel: 'Application approved',
      bodyText: `Congratulations! Your organizer application for <strong>${clubName}</strong> has been approved. You can now log in to RiaraTix and start creating events, managing ticket sales, and checking in attendees.`,
      footer: 'Welcome to the RiaraTix organizers! Head to your dashboard to get started.',
      cta: { text: 'Go to Dashboard', url: `${process.env.FRONTEND_URL}/dashboard.html` },
    },
    rejected: {
      subject: 'RiaraTix — Update on your organizer application',
      icon: '❌',
      headerBg: '#C0392B',
      headerLabel: 'Application not approved',
      bodyText: `Unfortunately, your organizer application for <strong>${clubName}</strong> was not approved at this time. You're welcome to re-apply after addressing the feedback.`,
      reasonBlock: reason ? `<div style="background:#fdf2f2;border-left:3px solid #C0392B;border-radius:6px;padding:12px 16px;margin:0 0 16px;font-size:13px;color:#6b6b66;line-height:1.6;"><strong style="color:#C0392B;display:block;margin-bottom:4px;">Reason for rejection:</strong>${reason}</div>` : '',
      footer: 'If you have questions, please reach out to the RiaraTix admin team. You may re-apply once the issue has been resolved.',
      cta: null,
    },
  };
 
  const cfg = configs[type];
  if (!cfg) throw new Error(`Unknown organizer email type: ${type}`);
 
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: cfg.subject,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f2ec;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
          <tr><td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
              <tr>
                <td style="background:${cfg.headerBg};padding:28px 32px;text-align:center;">
                  <div style="font-size:32px;margin-bottom:8px;">${cfg.icon}</div>
                  <div style="font-family:Georgia,serif;font-size:22px;color:#ffffff;">RiaraTix</div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">${cfg.headerLabel}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="font-size:16px;color:#1a1a18;margin:0 0 8px;">Hi ${firstName},</p>
                  <p style="font-size:14px;color:#6b6b66;line-height:1.7;margin:0 0 24px;">${cfg.bodyText}</p>
                  ${cfg.reasonBlock || ''}
 
                  <div style="background:#f4f2ec;border-radius:12px;padding:20px;margin-bottom:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:4px;">CLUB / SOCIETY</td>
                        <td style="font-size:13px;font-weight:600;color:#1a1a18;text-align:right;">${clubName}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-top:8px;">STATUS</td>
                        <td style="font-size:13px;font-weight:600;color:${cfg.headerBg};text-align:right;padding-top:8px;">${cfg.headerLabel}</td>
                      </tr>
                    </table>
                  </div>
 
                  ${cfg.cta ? `
                  <div style="text-align:center;margin-bottom:24px;">
                    <a href="${cfg.cta.url}"
                       style="background:${cfg.headerBg};color:#fff;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:600;display:inline-block;text-decoration:none;">
                      ${cfg.cta.text}
                    </a>
                  </div>` : ''}
 
                  <p style="font-size:13px;color:#6b6b66;line-height:1.6;margin:0;">${cfg.footer}</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f4f2ec;padding:16px 32px;border-top:1px solid rgba(0,0,0,0.08);">
                  <p style="font-size:12px;color:#6b6b66;margin:0;text-align:center;">
                    © 2026 RiaraTix · Built for Riara University<br/>
                    This is an automated message, please do not reply.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
}
 
 
async function sendCompTicketEmail(to, guest_name, { eventTitle, venue, startsAt, qrCode, qrBuffer, ticketId }) {
  const firstName = guest_name.split(' ')[0];
  const dateStr = startsAt ? new Date(startsAt).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'TBA';
  const timeStr = startsAt ? new Date(startsAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
 
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `RiaraTix — Complimentary ticket for ${eventTitle} 🎟️`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f2ec;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
          <tr><td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
              <tr>
                <td style="background:#0F6E56;padding:28px 32px;text-align:center;">
                  <div style="font-size:32px;margin-bottom:8px;">🎟️</div>
                  <div style="font-family:Georgia,serif;font-size:22px;color:#ffffff;">RiaraTix</div>
                  <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">Complimentary ticket</div>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="font-size:16px;color:#1a1a18;margin:0 0 8px;">Hi ${firstName},</p>
                  <p style="font-size:14px;color:#6b6b66;line-height:1.7;margin:0 0 24px;">
                    You've been issued a complimentary ticket for <strong>${eventTitle}</strong>.
                    Your QR code is attached below — present it at the entrance on the day of the event.
                  </p>
                  <div style="background:#f4f2ec;border-radius:12px;padding:20px;margin-bottom:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:8px;">EVENT</td>
                        <td style="font-size:13px;font-weight:600;color:#1a1a18;text-align:right;padding-bottom:8px;">${eventTitle}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;padding-bottom:8px;">DATE</td>
                        <td style="font-size:13px;font-weight:600;color:#1a1a18;text-align:right;padding-bottom:8px;">${dateStr}${timeStr ? ' at ' + timeStr : ''}</td>
                      </tr>
                      <tr>
                        <td style="font-size:12px;color:#6b6b66;">VENUE</td>
                        <td style="font-size:13px;font-weight:600;color:#1a1a18;text-align:right;">${venue}</td>
                      </tr>
                    </table>
                  </div>
                  <div style="text-align:center;margin-bottom:24px;">
                    <p style="font-size:13px;color:#6b6b66;margin-bottom:12px;">Your entry QR code — screenshot or print this:</p>
                    <img src="cid:qrcode" alt="QR Code" style="width:200px;height:200px;border:4px solid #0F6E56;border-radius:12px;" />
                  </div>
                  <p style="font-size:13px;color:#6b6b66;line-height:1.6;margin:0;">
                    This ticket is non-transferable and valid for one entry only.
                    Please do not share your QR code with others.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="background:#f4f2ec;padding:16px 32px;border-top:1px solid rgba(0,0,0,0.08);">
                  <p style="font-size:12px;color:#6b6b66;margin:0;text-align:center;">
                    © 2026 RiaraTix · Built for Riara University<br/>
                    This is an automated message, please do not reply.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
    attachments: [{
      filename: 'ticket-qr.png',
      content: qrBuffer,
      cid: 'qrcode',
    }],
  });
}
module.exports = { sendOTPEmail, sendReminderEmail, sendOrganizerEmail, sendCompTicketEmail };