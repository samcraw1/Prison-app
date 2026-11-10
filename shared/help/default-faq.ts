// Platform-wide answers for the family help bot (src/app/api/help/chat). Pure data, no Next/RN imports.
// Keep this factual and in step with the app: the bot is told to answer only from this list and the facility's own
// FAQ and policies. Facility-specific rules (hours, ID rules, dress code, etc.) belong in the facility's FAQ, which
// staff edit at /staff/settings/help.

export type FaqEntry = { q: string; a: string };

export const DEFAULT_FAQ: FaqEntry[] = [
  {
    q: "How do I connect with someone in a facility?",
    a: "Open Connect, choose the facility, and enter the person's full name and booking number exactly as the facility has them. Add your relationship and a photo of your government ID. Facility staff review every request; you can message and schedule visits once they approve it.",
  },
  {
    q: "Why was my connection request not approved yet?",
    a: "Staff at the person's facility review each request by hand, including your ID photo. If the name or booking number didn't match their records, staff check the details themselves before approving or denying. The app can't speed this up; contact the facility if it is taking a long time.",
  },
  {
    q: "Why is my message held or pending?",
    a: "Facility staff review messages. Depending on the facility's rules, every message may wait for approval, or only messages that match the facility's review rules. A held message is delivered once staff approve it. If staff reject it, you'll see that it was not delivered.",
  },
  {
    q: "Who can read my messages?",
    a: "The person you're writing to and the facility's staff. All messages are monitored and reviewed by the facility. Notifications on your phone never include the message text.",
  },
  {
    q: "How do video visits work?",
    a: "Request a visit time from the open times the facility offers. Staff approve or deny the request. You can join from 5 minutes before the start time. Visits are monitored by facility staff, staff may end a visit at any time, and the call ends automatically when the time is up.",
  },
  {
    q: "Can I cancel a visit?",
    a: "Yes, you can cancel a requested or approved visit before its join window opens, from the Visits screen.",
  },
  {
    q: "How do I report or block someone?",
    a: "In a conversation, use the Report or block option. Reports go to the facility's staff.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Account and choose Delete account. Your account is deleted 30 days after you confirm, and you can cancel any time before then. After that your name, email, phone and ID photo are erased and you can't sign in. Messages and visits stay in the facility's records as \"Deleted user\".",
  },
  {
    q: "I need legal advice or help with a case.",
    a: "This assistant can't give legal advice. Contact a lawyer, a public defender's office, or a legal aid organization.",
  },
];
