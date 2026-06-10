import { db, emailTemplatesTable, emailTemplateVersionsTable, smsTemplatesTable } from "@workspace/db";
import { sql, eq, inArray, desc } from "drizzle-orm";
import crypto from "node:crypto";

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1>
</td></tr>
<tr><td style="padding:30px;">
${body}
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;">
<p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const transactionalEmailTemplates = [
  {
    slug: "welcome",
    name: "Welcome Email",
    subject: "Welcome to Build Test Scale, {{member_name}}!",
    htmlBody: wrapHtml("Welcome", `
<h2 style="color:#1a1a2e;margin-top:0;">Welcome to Build Test Scale!</h2>
<p>Hi {{member_name}},</p>
<p>We're thrilled to have you join the BTS community. Your account has been created and you're ready to start your journey.</p>
<p>Your temporary password is: <strong>{{temp_password}}</strong></p>
<p>Please log in and change your password as soon as possible.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Log In to Your Portal</a></p>
<p>If you have any questions, reply to this email or reach out to {{support_email}}.</p>
<p>Welcome aboard!<br>The BTS Team</p>`),
    textBody: "Welcome to Build Test Scale, {{member_name}}!\n\nYour temporary password is: {{temp_password}}\n\nLog in at {{portal_url}} and change your password.\n\nWelcome aboard!\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "temp_password", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_verification",
    name: "Email Verification",
    subject: "Verify your email address",
    htmlBody: wrapHtml("Email Verification", `
<h2 style="color:#1a1a2e;margin-top:0;">Verify Your Email</h2>
<p>Hi {{member_name}},</p>
<p>Please verify your email address to complete your account setup.</p>
<p><a href="{{portal_url}}/verify-email?token={{verify_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nVerify your email: {{portal_url}}/verify-email?token={{verify_token}}\n\nThis link expires in 24 hours.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "verify_token", "portal_url", "current_year"],
  },
  {
    slug: "password_reset",
    name: "Password Reset",
    subject: "Reset your password",
    htmlBody: wrapHtml("Password Reset", `
<h2 style="color:#1a1a2e;margin-top:0;">Reset Your Password</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to reset your password. Click the button below to set a new password.</p>
<p><a href="{{portal_url}}/reset-password?token={{reset_token}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nReset your password: {{portal_url}}/reset-password?token={{reset_token}}\n\nThis link expires in 1 hour.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "reset_token", "portal_url", "current_year"],
  },
  {
    slug: "signup_attempted",
    name: "Signup Attempted on Existing Email",
    subject: "Someone tried to sign up with your email",
    htmlBody: wrapHtml("Signup Attempted", `
<h2 style="color:#1a1a2e;margin-top:0;">Signup Attempt on Your Account</h2>
<p>Hi {{member_name}},</p>
<p>Someone just tried to create a new Build Test Scale account using <strong>{{member_email}}</strong>. Since this address already has an account, no new account was created.</p>
<p>If this was you, you can sign in or reset your password instead — there's no need to create a new account:</p>
<p>
<a href="{{portal_url}}/login?email={{member_email_encoded}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:8px;">Sign In</a>
<a href="{{portal_url}}/forgot-password?email={{member_email_encoded}}" style="display:inline-block;background:#ffffff;color:#4f46e5;border:1px solid #4f46e5;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, you can safely ignore this email — your account is unchanged. If you're seeing repeated attempts, contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nSomeone just tried to create a new Build Test Scale account using {{member_email}}. Since this address already has an account, no new account was created.\n\nIf this was you, sign in: {{portal_url}}/login?email={{member_email_encoded}}\nOr reset your password: {{portal_url}}/forgot-password?email={{member_email_encoded}}\n\nIf this wasn't you, you can ignore this email — your account is unchanged.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "member_email_encoded", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "new_device_signin",
    name: "New Sign-in Detected",
    subject: "New sign-in to your Build Test Scale account",
    htmlBody: wrapHtml("New Sign-in Detected", `
<h2 style="color:#1a1a2e;margin-top:0;">New Sign-in Detected</h2>
<p>Hi {{member_name}},</p>
<p>Your Build Test Scale account was just signed in to from a device we haven't seen before:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Device:</strong> {{device_description}}<br>
<strong>IP address:</strong> {{ip_address}}<br>
<strong>When:</strong> {{sign_in_time}}
</p>
<p>If this was you, no action is needed.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away.</p>
<p><a href="{{portal_url}}/account#sessions" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review your devices</a></p>
<p>Questions? Contact <a href="mailto:{{support_email}}" style="color:#4f46e5;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour Build Test Scale account was just signed in to from a device we haven't seen before:\n\nDevice: {{device_description}}\nIP address: {{ip_address}}\nWhen: {{sign_in_time}}\n\nIf this was you, no action is needed.\n\nIf this wasn't you, your account may be compromised. Review where you're signed in and sign out the device you don't recognize, then change your password right away:\n{{portal_url}}/account#sessions\n\nQuestions? Contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "device_description", "ip_address", "sign_in_time", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_verify",
    name: "Email Change Verification",
    subject: "Confirm your new Build Test Scale email address",
    htmlBody: wrapHtml("Confirm New Email", `
<h2 style="color:#1a1a2e;margin-top:0;">Confirm Your New Email</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale account from <strong>{{old_email}}</strong> to <strong>{{new_email}}</strong>.</p>
<p>Click the button below within 24 hours to confirm this change. After confirming, you'll need to sign in again using your new email address.</p>
<p><a href="{{portal_url}}/verify-email-change?token={{verify_token}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Confirm New Email</a></p>
<p>If you didn't request this change, you can safely ignore this email — your address will stay the same.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nConfirm changing your Build Test Scale email from {{old_email}} to {{new_email}}:\n{{portal_url}}/verify-email-change?token={{verify_token}}\n\nThis link expires in 24 hours. If you didn't request this, ignore this email.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "old_email", "new_email", "verify_token", "portal_url", "current_year"],
  },
  {
    slug: "email_change_notice",
    name: "Email Change Notice (Old Address)",
    subject: "Email change requested on your Build Test Scale account",
    htmlBody: wrapHtml("Email Change Requested", `
<h2 style="color:#1a1a2e;margin-top:0;">Email Change Requested</h2>
<p>Hi {{member_name}},</p>
<p>We received a request to change the email address on your Build Test Scale account to <strong>{{new_email}}</strong>. The change will only take effect once it's confirmed from the new address.</p>
<p>If this was you, no further action is needed at this address — just confirm the change from your new inbox.</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, please sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>. Your current email address will keep working until the new one is confirmed.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWe received a request to change your Build Test Scale email to {{new_email}}. The change only takes effect after it's confirmed from the new address.\n\nIf this wasn't you, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "new_email", "support_email", "portal_url", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_admin",
    name: "Email Change Cancelled by Admin",
    subject: "Your pending email change was cancelled by Build Test Scale support",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Our support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>If you still meant to switch your account to <strong>{{cancelled_pending_email}}</strong> (or another address), use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting support to cancel this change, or you have any questions, please reply to this email or reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nOur support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nIf you still meant to switch your account to {{cancelled_pending_email}} (or another address), open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you weren't expecting this, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "cancelled_pending_email", "restart_url", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_admin_pending",
    name: "Email Change Cancelled by Admin (Pending Address)",
    subject: "A pending email change to this address was cancelled by Build Test Scale support",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale account to <strong>{{cancelled_pending_email}}</strong> — this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale account to {{cancelled_pending_email}} — this inbox. Our support team has since cancelled that pending change, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["cancelled_pending_email", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_member",
    name: "Email Change Cancelled by Member",
    subject: "Your pending email change was cancelled",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>You just cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>Changed your mind, or made a typo the first time? Use the button below — we'll drop you straight onto the email-change form with the previously requested address pre-filled so you don't have to retype it. You'll still need to sign in and re-enter your password to confirm the change.</p>
<p><a href="{{restart_url}}" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start a new email change</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you <strong>didn't</strong> cancel this change yourself, sign in and reset your password immediately, then contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou just cancelled the pending email change on your Build Test Scale account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nChanged your mind, or made a typo the first time? Open this link to jump straight to the email-change form with the previous address pre-filled (you'll still need to sign in and re-enter your password):\n{{restart_url}}\n\nIf you didn't cancel this change yourself, sign in and reset your password immediately, then contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "member_email", "cancelled_pending_email", "restart_url", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "email_change_cancelled_by_member_pending",
    name: "Email Change Cancelled (Pending Address)",
    subject: "A pending email change to this address was cancelled",
    htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hello,</p>
<p>Someone recently asked us to switch the email address on a Build Test Scale account to <strong>{{cancelled_pending_email}}</strong> — this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.</p>
<p><strong>No action is required from you.</strong> You don't need to click anything, sign in, or reply.</p>
<p style="margin-top:24px;padding:12px 16px;background:#f3f4f6;border-left:4px solid #6b7280;color:#374151;">If you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions or believe you're receiving these messages by mistake, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hello,\n\nSomeone recently asked us to switch the email address on a Build Test Scale account to {{cancelled_pending_email}} — this inbox. That request has since been withdrawn, so this address was never linked to the account and the verification link we sent earlier no longer works.\n\nNo action is required from you. You don't need to click anything, sign in, or reply.\n\nIf you weren't expecting any messages from us, you can safely ignore this email — this address has not been added to any account. If you have questions, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["cancelled_pending_email", "support_email", "current_year"],
  },
  {
    slug: "purchase_confirmation",
    name: "Purchase Confirmation",
    subject: "Your purchase of {{product_name}} is confirmed!",
    htmlBody: wrapHtml("Purchase Confirmation", `
<h2 style="color:#1a1a2e;margin-top:0;">Purchase Confirmed!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your purchase of <strong>{{product_name}}</strong> has been confirmed and your access is now active.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>If you have any questions about getting started, our support team is here to help.</p>
<p>Let's build something great!<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour purchase of {{product_name}} is confirmed! Access is now active.\n\nLog in at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "payment_failed",
    name: "Payment Failed",
    subject: "Action required: Payment failed for {{product_name}}",
    htmlBody: wrapHtml("Payment Failed", `
<h2 style="color:#dc2626;margin-top:0;">Payment Failed</h2>
<p>Hi {{member_name}},</p>
<p>We were unable to process your payment for <strong>{{product_name}}</strong>.</p>
<p>Your access will remain active until <strong>{{grace_date}}</strong> while we retry your payment. Please update your payment information to avoid losing access.</p>
<p><a href="{{portal_url}}/settings/billing" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Update Payment Info</a></p>
<p>If you need help, contact us at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nPayment failed for {{product_name}}. Your access continues until {{grace_date}}.\n\nPlease update your payment info at {{portal_url}}/settings/billing\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "grace_date", "portal_url", "support_email", "current_year"],
  },
  {
    slug: "payment_recovered",
    name: "Payment Recovered",
    subject: "Payment successful — {{product_name}} access restored",
    htmlBody: wrapHtml("Payment Recovered", `
<h2 style="color:#16a34a;margin-top:0;">Payment Successful!</h2>
<p>Hi {{member_name}},</p>
<p>Great news — your payment for <strong>{{product_name}}</strong> has been successfully processed and your access continues uninterrupted.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour payment for {{product_name}} was successful. Access continues.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "refund_processed",
    name: "Refund Processed",
    subject: "Your refund for {{product_name}} has been processed",
    htmlBody: wrapHtml("Refund Processed", `
<h2 style="color:#1a1a2e;margin-top:0;">Refund Processed</h2>
<p>Hi {{member_name}},</p>
<p>Your refund for <strong>{{product_name}}</strong> has been processed. Your access to this product has been removed.</p>
<p>If you have questions or believe this was a mistake, contact us at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour refund for {{product_name}} has been processed. Access removed.\n\nContact {{support_email}} with questions.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "support_email", "current_year"],
  },
  {
    slug: "subscription_cancelled",
    name: "Subscription Cancelled",
    subject: "Your {{product_name}} subscription has been cancelled",
    htmlBody: wrapHtml("Subscription Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Subscription Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Your subscription for <strong>{{product_name}}</strong> has been cancelled. You'll continue to have access until the end of your current billing period.</p>
<p>Changed your mind? You can resubscribe at any time.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Manage Account</a></p>
<p>We're sorry to see you go.<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} subscription has been cancelled. Access continues until end of billing period.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expiring_warning",
    name: "Mentorship Expiring Warning (30 days)",
    subject: "Your {{product_name}} expires in less than 30 days",
    htmlBody: wrapHtml("Expiring Soon", `
<h2 style="color:#f59e0b;margin-top:0;">Your Access is Expiring Soon</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong>.</p>
<p>Don't lose access to your training, coaching calls, and community. Renew now to continue your journey.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} expires on {{expiration_date}}. Renew at {{portal_url}}/settings\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expiring_urgent",
    name: "Mentorship Expiring Urgent (7 days)",
    subject: "URGENT: Your {{product_name}} expires in less than 7 days!",
    htmlBody: wrapHtml("Expiring Urgently", `
<h2 style="color:#dc2626;margin-top:0;">Your Access Expires This Week!</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expires on <strong>{{expiration_date}}</strong> — that's less than 7 days away!</p>
<p>Act now to avoid losing access to all your training materials, coaching calls, and community.</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#dc2626;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Now — Don't Lose Access</a></p>
<p>The BTS Team</p>`),
    textBody: "URGENT: Hi {{member_name}}, your {{product_name}} expires on {{expiration_date}}! Renew now at {{portal_url}}/settings to keep your access.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "mentorship_expired",
    name: "Mentorship Expired",
    subject: "Your {{product_name}} access has expired",
    htmlBody: wrapHtml("Access Expired", `
<h2 style="color:#dc2626;margin-top:0;">Your Access Has Expired</h2>
<p>Hi {{member_name}},</p>
<p>Your <strong>{{product_name}}</strong> access expired on {{expiration_date}}.</p>
<p>To regain access to your training, coaching, and community, please renew your membership.</p>
<p><a href="{{portal_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Renew Membership</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{product_name}} access has expired. Renew at {{portal_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "expiration_date", "portal_url", "current_year"],
  },
  {
    slug: "ticket_created",
    name: "Support Ticket Created",
    subject: "Ticket #{{ticket_number}} received — we'll get back to you soon",
    htmlBody: wrapHtml("Ticket Created", `
<h2 style="color:#1a1a2e;margin-top:0;">We Received Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>Your support ticket <strong>#{{ticket_number}}</strong> has been received. Our team will review it and respond as soon as possible.</p>
<p><strong>Subject:</strong> {{ticket_subject}}</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Tickets</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nTicket #{{ticket_number}} received. Subject: {{ticket_subject}}\n\nWe'll respond soon.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "ticket_subject", "portal_url", "current_year"],
  },
  {
    slug: "ticket_reply",
    name: "Support Ticket Reply",
    subject: "New reply on ticket #{{ticket_number}}",
    htmlBody: wrapHtml("Ticket Reply", `
<h2 style="color:#1a1a2e;margin-top:0;">New Reply on Your Ticket</h2>
<p>Hi {{member_name}},</p>
<p>There's a new reply on your support ticket <strong>#{{ticket_number}}</strong>.</p>
<p><a href="{{portal_url}}/support" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Reply</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nNew reply on ticket #{{ticket_number}}. View it at {{portal_url}}/support\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "ticket_number", "portal_url", "current_year"],
  },
  {
    slug: "account_locked",
    name: "Account Locked",
    subject: "Your account has been temporarily locked",
    htmlBody: wrapHtml("Account Locked", `
<h2 style="color:#dc2626;margin-top:0;">Account Temporarily Locked</h2>
<p>Hi {{member_name}},</p>
<p>Your account has been temporarily locked due to too many failed login attempts. It will automatically unlock in 15 minutes.</p>
<p>If you've forgotten your password, you can reset it below.</p>
<p><a href="{{portal_url}}/forgot-password" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour account has been temporarily locked due to failed login attempts. It will unlock in 15 minutes. Reset password: {{portal_url}}/forgot-password\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "password_changed",
    name: "Password Changed",
    subject: "Your password has been changed",
    htmlBody: wrapHtml("Password Changed", `
<h2 style="color:#1a1a2e;margin-top:0;">Password Changed Successfully</h2>
<p>Hi {{member_name}},</p>
<p>Your password has been successfully changed. All existing sessions have been logged out for security.</p>
<p>If you didn't make this change, please contact us immediately at {{support_email}}.</p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour password has been changed. If you didn't do this, contact {{support_email}} immediately.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "support_email", "current_year"],
  },
  {
    slug: "flexy_password_reset",
    name: "Flexy Password Reset",
    subject: "Your new Flexy password",
    htmlBody: wrapHtml("Flexy Password Reset", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Flexy password has been reset</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just generated a new password for your Flexy login. Use the credentials below the next time you sign in.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;font-family:monospace;">
<strong>Login email:</strong> {{flexy_email}}<br>
<strong>New password:</strong> {{flexy_password}}
</p>
<p>For your security, change this password to something only you know after you log in. If you did not request this reset, contact us right away at {{support_email}}.</p>
<p><a href="{{flexy_login_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Flexy Login</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nOur support team just generated a new password for your Flexy login.\n\nLogin email: {{flexy_email}}\nNew password: {{flexy_password}}\n\nFor your security, change this password after you log in. If you did not request this reset, contact {{support_email}} right away.\n\nLog in at {{flexy_login_url}}\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "flexy_email", "flexy_password", "flexy_login_url", "support_email", "current_year"],
  },
  {
    slug: "tier_upgrade",
    name: "Tier Upgrade Confirmation",
    subject: "Welcome to {{product_name}} — you've been upgraded!",
    htmlBody: wrapHtml("Tier Upgrade", `
<h2 style="color:#16a34a;margin-top:0;">You've Been Upgraded!</h2>
<p>Hi {{member_name}},</p>
<p>Congratulations! Your access has been upgraded to <strong>{{product_name}}</strong>.</p>
<p>You now have access to additional training, coaching, and tools. Log in to explore everything that's new.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Explore Your New Access</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou've been upgraded to {{product_name}}! Log in at {{portal_url}}/dashboard to explore.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "product_name", "portal_url", "current_year"],
  },
  {
    slug: "role_changed",
    name: "Admin Role Changed",
    subject: "Your Build Test Scale role is now {{new_role_label}}",
    htmlBody: wrapHtml("Role Changed", `
<h2 style="color:#1a1a2e;margin-top:0;">Your role was updated</h2>
<p>Hi {{member_name}},</p>
<p>{{actor_name}} just updated your access on Build Test Scale.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;">
<strong>Previous role:</strong> {{previous_role_label}}<br>
<strong>New role:</strong> {{new_role_label}}
</p>
<p>This change takes effect the next time you sign in. You may notice that some admin tools you used before are no longer visible, or that new ones have appeared.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Your Dashboard</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting this change, please reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\n{{actor_name}} just updated your access on Build Test Scale.\n\nPrevious role: {{previous_role_label}}\nNew role: {{new_role_label}}\n\nThis change takes effect the next time you sign in. Open your dashboard at {{portal_url}}/dashboard.\n\nIf you weren't expecting this change, contact {{support_email}}.\n\nThe BTS Team",
    category: "transactional",
    variables: ["member_name", "actor_name", "previous_role_label", "new_role_label", "portal_url", "support_email", "current_year"],
  },
];

const marketingEmailTemplates = [
  {
    slug: "onboarding_day1",
    name: "Onboarding Day 1 — Getting Started",
    subject: "Your first step inside Build Test Scale",
    htmlBody: wrapHtml("Getting Started", `
<h2 style="color:#1a1a2e;margin-top:0;">Let's Get You Started</h2>
<p>Hi {{member_name}},</p>
<p>Welcome to Day 1! Here's the fastest way to get value from your BTS membership:</p>
<ol>
<li>Complete your profile and onboarding</li>
<li>Watch the first lesson in your training track</li>
<li>Check out the upcoming coaching calls</li>
</ol>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWelcome to Day 1! Get started:\n1. Complete your profile\n2. Watch your first lesson\n3. Check coaching calls\n\nStart at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "onboarding_day3",
    name: "Onboarding Day 3 — First Lesson Nudge",
    subject: "Have you started your first lesson yet?",
    htmlBody: wrapHtml("First Lesson", `
<h2 style="color:#1a1a2e;margin-top:0;">Time to Dive In</h2>
<p>Hi {{member_name}},</p>
<p>It's been a few days since you joined. The members who see results fastest are the ones who start their training right away.</p>
<p>Your first lesson is waiting — it only takes 15 minutes.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Your First Lesson</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nHave you started your first lesson? It only takes 15 minutes. Start at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "onboarding_day7",
    name: "Onboarding Day 7 — Week 1 Recap",
    subject: "Your first week at BTS — here's what's next",
    htmlBody: wrapHtml("Week 1 Recap", `
<h2 style="color:#1a1a2e;margin-top:0;">Your First Week Recap</h2>
<p>Hi {{member_name}},</p>
<p>You've been a BTS member for a week now. Here's what you should focus on next:</p>
<ul>
<li>Continue working through your training track</li>
<li>Join a live coaching call this week</li>
<li>Ask questions in the community</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check Your Progress</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour first week recap. Next steps: continue training, join a coaching call, engage with community.\n\n{{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "coaching_reminder",
    name: "Coaching Call Reminder",
    subject: "Live coaching call tomorrow: {{call_title}}",
    htmlBody: wrapHtml("Coaching Reminder", `
<h2 style="color:#1a1a2e;margin-top:0;">Coaching Call Tomorrow</h2>
<p>Hi {{member_name}},</p>
<p>Don't forget — there's a live coaching call happening tomorrow:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{call_title}}</strong><br>{{call_date}} at {{call_time}}</p>
<p><a href="{{portal_url}}/coaching" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Details</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nCoaching call tomorrow: {{call_title}} at {{call_time}}.\n\nDetails: {{portal_url}}/coaching\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "call_title", "call_date", "call_time", "portal_url", "current_year"],
  },
  {
    slug: "new_content_alert",
    name: "New Content Available",
    subject: "New content just dropped: {{content_title}}",
    htmlBody: wrapHtml("New Content", `
<h2 style="color:#1a1a2e;margin-top:0;">New Content Available!</h2>
<p>Hi {{member_name}},</p>
<p>We just published new content that's available to you:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{content_title}}</strong><br>{{content_description}}</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check It Out</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nNew content: {{content_title}} — {{content_description}}\n\nView at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "content_title", "content_description", "portal_url", "current_year"],
  },
  {
    slug: "streak_milestone",
    name: "Streak Milestone",
    subject: "You're on a {{streak_count}}-day streak! Keep it up!",
    htmlBody: wrapHtml("Streak Milestone", `
<h2 style="color:#16a34a;margin-top:0;">{{streak_count}}-Day Streak!</h2>
<p>Hi {{member_name}},</p>
<p>You've been consistently learning for <strong>{{streak_count}} days</strong> straight. That's the kind of consistency that builds real results.</p>
<p>Keep it going — momentum is everything in this business.</p>
<p><a href="{{portal_url}}/training" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Continue Learning</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou're on a {{streak_count}}-day streak! Keep it going at {{portal_url}}/training\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "streak_count", "portal_url", "current_year"],
  },
  {
    slug: "win_of_the_week",
    name: "Win of the Week",
    subject: "This week's biggest wins from the BTS community",
    htmlBody: wrapHtml("Win of the Week", `
<h2 style="color:#1a1a2e;margin-top:0;">This Week's Wins</h2>
<p>Hi {{member_name}},</p>
<p>Check out what members accomplished this week:</p>
<p>{{wins_content}}</p>
<p>Your win could be featured next! Keep pushing forward.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Back to Your Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nThis week's wins:\n{{wins_content}}\n\nYour win could be next!\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "wins_content", "portal_url", "current_year"],
  },
  {
    slug: "monthly_progress",
    name: "Monthly Progress Report",
    subject: "Your monthly progress report is ready",
    htmlBody: wrapHtml("Monthly Progress", `
<h2 style="color:#1a1a2e;margin-top:0;">Your Monthly Progress</h2>
<p>Hi {{member_name}},</p>
<p>Here's your progress for {{month_name}}:</p>
<ul>
<li>Lessons completed: {{lessons_completed}}</li>
<li>Coaching calls attended: {{calls_attended}}</li>
<li>Current streak: {{streak_count}} days</li>
</ul>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Full Dashboard</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYour {{month_name}} progress: {{lessons_completed}} lessons, {{calls_attended}} calls, {{streak_count}}-day streak.\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "month_name", "lessons_completed", "calls_attended", "streak_count", "portal_url", "current_year"],
  },
  {
    slug: "upgrade_offer",
    name: "Upgrade Offer",
    subject: "Ready for the next level? Upgrade to {{upgrade_product}}",
    htmlBody: wrapHtml("Upgrade Offer", `
<h2 style="color:#1a1a2e;margin-top:0;">Ready to Level Up?</h2>
<p>Hi {{member_name}},</p>
<p>You've been crushing it with your current access. Want to unlock even more?</p>
<p><strong>{{upgrade_product}}</strong> gives you:</p>
<ul>
<li>Advanced training modules</li>
<li>Live coaching calls</li>
<li>Community access</li>
<li>And much more</li>
</ul>
<p><a href="{{portal_url}}/upgrade" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">See Upgrade Options</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nReady for the next level? Upgrade to {{upgrade_product}} for advanced training, coaching, and more.\n\n{{portal_url}}/upgrade\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "upgrade_product", "portal_url", "current_year"],
  },
  {
    slug: "re_engagement",
    name: "Re-engagement — We Miss You",
    subject: "We miss you, {{member_name}}!",
    htmlBody: wrapHtml("We Miss You", `
<h2 style="color:#1a1a2e;margin-top:0;">We Miss You!</h2>
<p>Hi {{member_name}},</p>
<p>It's been a while since you logged in. Your training is waiting, and new content has been added since your last visit.</p>
<p>Jump back in — even 15 minutes a day can make a difference.</p>
<p><a href="{{portal_url}}/dashboard" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get Back to Learning</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nWe miss you! New content has been added. Jump back in at {{portal_url}}/dashboard\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "portal_url", "current_year"],
  },
  {
    slug: "community_announcement",
    name: "Community Announcement",
    subject: "{{announcement_title}}",
    htmlBody: wrapHtml("Announcement", `
<h2 style="color:#1a1a2e;margin-top:0;">{{announcement_title}}</h2>
<p>Hi {{member_name}},</p>
<p>{{announcement_body}}</p>
<p><a href="{{portal_url}}/announcements" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Read More</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\n{{announcement_title}}\n\n{{announcement_body}}\n\nRead more at {{portal_url}}/announcements\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "announcement_title", "announcement_body", "portal_url", "current_year"],
  },
  {
    slug: "event_invitation",
    name: "Event Invitation",
    subject: "You're invited: {{event_title}}",
    htmlBody: wrapHtml("Event Invitation", `
<h2 style="color:#1a1a2e;margin-top:0;">You're Invited!</h2>
<p>Hi {{member_name}},</p>
<p>We'd love for you to join us:</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;"><strong>{{event_title}}</strong><br>{{event_date}} at {{event_time}}<br>{{event_description}}</p>
<p><a href="{{portal_url}}/events" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">RSVP Now</a></p>
<p>The BTS Team</p>`),
    textBody: "Hi {{member_name}},\n\nYou're invited: {{event_title}} on {{event_date}} at {{event_time}}.\n\n{{event_description}}\n\nRSVP at {{portal_url}}/events\n\nThe BTS Team",
    category: "marketing",
    variables: ["member_name", "event_title", "event_date", "event_time", "event_description", "portal_url", "current_year"],
  },
];

const smsTemplates = [
  {
    slug: "welcome",
    name: "Welcome SMS",
    body: "Welcome to Build Test Scale, {{member_name}}! Log in to get started: {{portal_url}}",
    variables: ["member_name", "portal_url"],
  },
  {
    slug: "purchase_confirmation",
    name: "Purchase Confirmation SMS",
    body: "Your purchase of {{product_name}} is confirmed! Access is now active. Log in: {{portal_url}}",
    variables: ["product_name", "portal_url"],
  },
  {
    slug: "payment_failed",
    name: "Payment Failed SMS",
    body: "BTS: Payment failed for {{product_name}}. Please update your payment info to avoid losing access: {{portal_url}}/settings/billing",
    variables: ["product_name", "portal_url"],
  },
  {
    slug: "coaching_reminder",
    name: "Coaching Call Reminder SMS",
    body: "BTS: Live coaching call tomorrow — {{call_title}}. Don't miss it! Details: {{portal_url}}/coaching",
    variables: ["call_title", "portal_url"],
  },
  {
    slug: "mentorship_expiring",
    name: "Mentorship Expiring SMS",
    body: "BTS: Your {{product_name}} expires on {{expiration_date}}. Renew now to keep access: {{portal_url}}/settings",
    variables: ["product_name", "expiration_date", "portal_url"],
  },
  {
    slug: "verification_code",
    name: "Verification Code SMS",
    body: "Your BTS verification code is {{code}}. It expires in 10 minutes.",
    variables: ["code"],
  },
  {
    slug: "password_reset",
    name: "Password Reset SMS",
    body: "BTS: Your password reset link: {{portal_url}}/reset-password?token={{reset_token}} — expires in 1 hour.",
    variables: ["reset_token", "portal_url"],
  },
  {
    slug: "flexy_password_reset",
    name: "Flexy Password Reset SMS",
    body: "BTS: Your Flexy password was just reset. Login: {{flexy_email}} / Password: {{flexy_password}}. Change it after you log in.",
    variables: ["flexy_email", "flexy_password"],
  },
];

export type StarterEmailTemplate = (typeof transactionalEmailTemplates)[number];

export type StarterContent = Pick<StarterEmailTemplate, "name" | "subject" | "htmlBody" | "textBody">;

/**
 * SHA-256 fingerprint of a starter template's user-visible content. Stored on
 * `email_templates.starter_hash` so we can tell whether a row is still tracking
 * the starter copy or has been customized via the admin UI.
 *
 * Field set deliberately excludes `category`, `variables`, `fromName`, and
 * `active` — admins flipping `active`/`fromName` should not block starter copy
 * refreshes, and category/variables are unlikely to drift in practice.
 */
export function templateContentHash(t: StarterContent): string {
  const payload = JSON.stringify({
    name: t.name,
    subject: t.subject,
    htmlBody: t.htmlBody,
    textBody: t.textBody,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Earlier versions of starter copy that we still want to recognize as
 * "untouched" on existing deployments where the row was seeded before the
 * `starter_hash` column existed (so the column is NULL but the content still
 * matches a previous starter — meaning no admin has customized it).
 *
 * Keep in chronological order; only add an entry when the live starter copy
 * for a slug actually changes. Slugs whose copy has never changed don't need
 * an entry — the current copy in `transactionalEmailTemplates` is recognized
 * automatically.
 */
export const priorStarterRevisions: Record<string, StarterContent[]> = {
  // Pre-Task #152 copy: button colors used #1a56db and the "no need to create
  // a new account" sub-clause was missing.
  signup_attempted: [
    {
      name: "Signup Attempted on Existing Email",
      subject: "Someone tried to sign up with your email",
      htmlBody: wrapHtml("Signup Attempted", `
<h2 style="color:#1a1a2e;margin-top:0;">Signup Attempt on Your Account</h2>
<p>Hi {{member_name}},</p>
<p>Someone just tried to create a new Build Test Scale account using <strong>{{member_email}}</strong>. Since this address already has an account, no new account was created.</p>
<p>If this was you, you can sign in or reset your password instead:</p>
<p>
<a href="{{portal_url}}/login" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-right:8px;">Sign In</a>
<a href="{{portal_url}}/forgot-password" style="display:inline-block;background:#ffffff;color:#1a56db;border:1px solid #1a56db;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset Password</a>
</p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If this <strong>wasn't you</strong>, you can safely ignore this email — your account is unchanged. If you're seeing repeated attempts, contact <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>The BTS Team</p>`),
      textBody: "Hi {{member_name}},\n\nSomeone just tried to create a new Build Test Scale account using {{member_email}}. Since this address already has an account, no new account was created.\n\nIf this was you, sign in: {{portal_url}}/login\nOr reset your password: {{portal_url}}/forgot-password\n\nIf this wasn't you, you can ignore this email — your account is unchanged.\n\nThe BTS Team",
    },
  ],
  // Pre-Task #242 copy: pointed members at /settings instead of the dedicated
  // restart link (no `restart_url` variable yet).
  email_change_cancelled_by_admin: [
    {
      name: "Email Change Cancelled by Admin",
      subject: "Your pending email change was cancelled by Build Test Scale support",
      htmlBody: wrapHtml("Pending Email Change Cancelled", `
<h2 style="color:#1a1a2e;margin-top:0;">Pending Email Change Cancelled</h2>
<p>Hi {{member_name}},</p>
<p>Our support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — <strong>{{cancelled_pending_email}}</strong> — has been discarded and was never activated.</p>
<p>Your account email remains <strong>{{member_email}}</strong>, which is the address you should keep using to sign in. <strong>No further action is required from you.</strong></p>
<p>If you still want to switch your account to a different email address, you can start a new request anytime from your account settings:</p>
<p><a href="{{portal_url}}/settings" style="display:inline-block;background:#1a56db;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to Account Settings</a></p>
<p style="margin-top:24px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;color:#991b1b;">If you weren't expecting support to cancel this change, or you have any questions, please reply to this email or reach out to <a href="mailto:{{support_email}}" style="color:#1a56db;">{{support_email}}</a>.</p>
<p>Thanks,<br>The BTS Team</p>`),
      textBody: "Hi {{member_name}},\n\nOur support team has cancelled the pending email change on your Build Test Scale account. The address we had queued — {{cancelled_pending_email}} — has been discarded and was never activated.\n\nYour account email remains {{member_email}}, which is the address you should keep using to sign in. No further action is required from you.\n\nIf you still want to switch your account to a different email address, you can start a new request anytime from your account settings: {{portal_url}}/settings\n\nIf you weren't expecting this, contact {{support_email}}.\n\nThe BTS Team",
    },
  ],
};

/** Slugs that the seed routine guarantees exist in every deployment. */
export const REQUIRED_TEMPLATE_SLUGS = [
  "email_change_verify",
  "email_change_notice",
  "email_change_cancelled_by_admin",
  "email_change_cancelled_by_admin_pending",
  "email_change_cancelled_by_member",
  "email_change_cancelled_by_member_pending",
  "signup_attempted",
  "new_device_signin",
  "role_changed",
] as const;

/**
 * Map of slug -> starter copy. Includes both transactional and marketing
 * starter templates so the admin-facing "Restore default" endpoint works for
 * any seeded slug.
 */
const allStarterTemplates: StarterEmailTemplate[] = [
  ...transactionalEmailTemplates,
  ...marketingEmailTemplates,
];
const starterTemplatesBySlug = new Map(allStarterTemplates.map(t => [t.slug, t]));

/** Look up starter copy for a slug, or null if no starter is defined. */
export function getStarterEmailTemplate(slug: string): StarterEmailTemplate | null {
  return starterTemplatesBySlug.get(slug) ?? null;
}

/** Returns the set of starter slugs that have a starter copy on file. */
export function listStarterEmailTemplateSlugs(): string[] {
  return Array.from(starterTemplatesBySlug.keys());
}

/**
 * Returns the set of content hashes the seed routine recognizes as starter
 * copy for the given slug — the current starter plus any prior revisions
 * captured in `priorStarterRevisions`. Used to detect untouched legacy rows
 * whose `starter_hash` column was never populated.
 */
function knownStarterHashesForSlug(slug: string): Set<string> {
  const current = starterTemplatesBySlug.get(slug);
  const hashes = new Set<string>();
  if (current) hashes.add(templateContentHash(current));
  for (const prior of priorStarterRevisions[slug] ?? []) {
    hashes.add(templateContentHash(prior));
  }
  return hashes;
}

async function snapshotTemplateVersion(template: {
  id: number;
  slug: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  category: string;
  fromName: string | null;
  variables: string[] | null;
}, savedBy: number | null): Promise<void> {
  const versions = await db
    .select({ id: emailTemplateVersionsTable.id, version: emailTemplateVersionsTable.version })
    .from(emailTemplateVersionsTable)
    .where(eq(emailTemplateVersionsTable.templateId, template.id))
    .orderBy(desc(emailTemplateVersionsTable.version));
  const nextVersion = versions[0] ? versions[0].version + 1 : 1;
  await db.insert(emailTemplateVersionsTable).values({
    templateId: template.id,
    version: nextVersion,
    slug: template.slug,
    name: template.name,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    category: template.category,
    fromName: template.fromName,
    variables: template.variables,
    savedBy,
  });
  // Same retention cap as the admin PUT endpoint: keep the most recent 10
  // snapshots and drop the rest.
  if (versions.length >= 10) {
    const toDelete = versions.slice(9).map(v => v.id);
    if (toDelete.length > 0) {
      await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.id, toDelete));
    }
  }
}

export async function seedCommunicationTemplates(): Promise<void> {
  console.log("Seeding communication templates...");

  await db.execute(sql`TRUNCATE TABLE email_templates, sms_templates RESTART IDENTITY CASCADE`);

  const allEmailTemplatesWithHash = allStarterTemplates.map(t => ({
    ...t,
    starterHash: templateContentHash(t),
  }));
  await db.insert(emailTemplatesTable).values(allEmailTemplatesWithHash);
  console.log(`  Seeded ${transactionalEmailTemplates.length} transactional + ${marketingEmailTemplates.length} marketing email templates`);

  await db.insert(smsTemplatesTable).values(smsTemplates);
  console.log(`  Seeded ${smsTemplates.length} SMS templates`);

  console.log("Communication templates seeding complete!");
}

export interface EnsureRequiredEmailTemplatesResult {
  inserted: string[];
  refreshed: string[];
  backfilled: string[];
  skippedCustomized: string[];
}

/**
 * Run on every API server boot. Guarantees the REQUIRED templates exist and,
 * for rows we can prove are still untouched starter copy, refreshes them to
 * the latest content. Rows that have been customized via the admin UI (i.e.
 * `starter_hash` was cleared by the PUT route) are never overwritten.
 *
 * Pass `templates`/`requiredSlugs` to override the starter set in tests so
 * specs can exercise the refresh logic without clobbering production starter
 * rows.
 */
export async function ensureRequiredEmailTemplates(opts?: {
  templates?: ReadonlyArray<StarterEmailTemplate>;
  requiredSlugs?: ReadonlyArray<string>;
  priorRevisions?: Record<string, StarterContent[]>;
}): Promise<EnsureRequiredEmailTemplatesResult> {
  const templates = opts?.templates ?? transactionalEmailTemplates;
  const requiredSlugs = opts?.requiredSlugs ?? REQUIRED_TEMPLATE_SLUGS;
  const priorRevs = opts?.priorRevisions ?? priorStarterRevisions;
  const result: EnsureRequiredEmailTemplatesResult = {
    inserted: [],
    refreshed: [],
    backfilled: [],
    skippedCustomized: [],
  };

  try {
    const existingRows = await db
      .select()
      .from(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.slug, [...requiredSlugs]));
    const existingBySlug = new Map(existingRows.map(r => [r.slug, r]));

    for (const slug of requiredSlugs) {
      const starter = templates.find(t => t.slug === slug);
      if (!starter) continue;
      const currentHash = templateContentHash(starter);
      const existing = existingBySlug.get(slug);

      if (!existing) {
        await db.insert(emailTemplatesTable).values({
          ...starter,
          starterHash: currentHash,
        });
        result.inserted.push(slug);
        continue;
      }

      // Already up to date.
      if (existing.starterHash === currentHash) continue;

      // Previously seeded by us, starter copy has changed since — refresh.
      if (existing.starterHash !== null) {
        await snapshotTemplateVersion(existing, null);
        await db.update(emailTemplatesTable).set({
          name: starter.name,
          subject: starter.subject,
          htmlBody: starter.htmlBody,
          textBody: starter.textBody,
          category: starter.category,
          variables: starter.variables,
          starterHash: currentHash,
        }).where(eq(emailTemplatesTable.id, existing.id));
        result.refreshed.push(slug);
        continue;
      }

      // starter_hash is NULL — could be a legacy row from before the column
      // existed, or an admin-customized row. Tell them apart by checking
      // whether the row's actual content matches a known starter fingerprint.
      const knownHashes: Set<string> = new Set([
        currentHash,
        ...(priorRevs[slug] ?? []).map(templateContentHash),
      ]);
      const rowHash = templateContentHash(existing);
      if (!knownHashes.has(rowHash)) {
        result.skippedCustomized.push(slug);
        continue;
      }

      // Row content is a known starter version. If it already matches current,
      // just stamp the hash. Otherwise snapshot + update + stamp.
      if (rowHash === currentHash) {
        await db.update(emailTemplatesTable)
          .set({ starterHash: currentHash })
          .where(eq(emailTemplatesTable.id, existing.id));
        result.backfilled.push(slug);
      } else {
        await snapshotTemplateVersion(existing, null);
        await db.update(emailTemplatesTable).set({
          name: starter.name,
          subject: starter.subject,
          htmlBody: starter.htmlBody,
          textBody: starter.textBody,
          category: starter.category,
          variables: starter.variables,
          starterHash: currentHash,
        }).where(eq(emailTemplatesTable.id, existing.id));
        result.refreshed.push(slug);
      }
    }

    if (
      result.inserted.length ||
      result.refreshed.length ||
      result.backfilled.length ||
      result.skippedCustomized.length
    ) {
      console.log(
        `[Seed] ensureRequiredEmailTemplates: ` +
          `inserted=[${result.inserted.join(",")}] ` +
          `refreshed=[${result.refreshed.join(",")}] ` +
          `backfilled=[${result.backfilled.join(",")}] ` +
          `skippedCustomized=[${result.skippedCustomized.join(",")}]`,
      );
    }
  } catch (err) {
    console.error("[Seed] ensureRequiredEmailTemplates failed:", err);
  }
  return result;
}
