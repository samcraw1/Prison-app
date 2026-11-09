import { ActionSheetIOS, Alert, Platform } from "react-native";
import { supabase } from "./supabase";

// Reporting and blocking (App Store guideline 1.2). Reports go to the resident's facility staff queue; blocking hides
// the conversation and stops messages and visit requests both ways until the contact is unblocked in Account.
const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or abuse" },
  { value: "threats", label: "Threats" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
];

function choose(title: string, labels: string[], onPick: (i: number) => void) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions({ title, options: ["Cancel", ...labels], cancelButtonIndex: 0 }, (i) => { if (i > 0) onPick(i - 1); });
  } else {
    Alert.alert(title, undefined, [...labels.map((l, i) => ({ text: l, onPress: () => onPick(i) })), { text: "Cancel", style: "cancel" as const }]);
  }
}

export function blockContact(contactId: string, name: string, onDone: () => void) {
  Alert.alert(
    `Block ${name}?`,
    "You won't see their messages or be able to message them or book visits with them. You can unblock them any time in Account > Blocked contacts. Facility staff keep their own records.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block", style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("block_contact", { p_contact: contactId });
          if (error) Alert.alert("Couldn't block", "Please try again.");
          else onDone();
        },
      },
    ],
  );
}

export function reportContent(contactId: string, messageId: string | null, name: string, onBlock: () => void) {
  choose("Why are you reporting this?", REASONS.map((r) => r.label), async (i) => {
    const { error } = await supabase.rpc("report_content", { p_contact: contactId, p_message: messageId, p_reason: REASONS[i].value });
    if (error) { Alert.alert("Couldn't send report", "Please try again."); return; }
    Alert.alert("Report sent", "Facility staff will review it. Would you also like to block this contact?", [
      { text: "Not now", style: "cancel" },
      { text: `Block ${name}`, style: "destructive", onPress: onBlock },
    ]);
  });
}

export function threadMenu(contactId: string, name: string, onBlocked: () => void) {
  choose(name, ["Report a problem", `Block ${name}`], (i) => {
    const block = () => blockContact(contactId, name, onBlocked);
    if (i === 0) reportContent(contactId, null, name, block); else block();
  });
}

export function messageMenu(contactId: string, messageId: string, name: string, onBlocked: () => void) {
  choose("Message from " + name, ["Report this message", `Block ${name}`], (i) => {
    const block = () => blockContact(contactId, name, onBlocked);
    if (i === 0) reportContent(contactId, messageId, name, block); else block();
  });
}
