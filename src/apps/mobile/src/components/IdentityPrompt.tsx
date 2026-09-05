import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import { PrimaryButton, TextField } from "@/components/form";
import { Muted } from "@/components/ui";
import {
  handleAvailable,
  normaliseHandle,
  setIdentity,
  suggestHandle,
} from "@/db/repo";
import { radius, space, type, useTheme } from "@/theme";

/**
 * Who are you? Asked once, before anything else.
 *
 * There is no sign-in in the alpha and nothing leaves the phone, so this is
 * not an account: it is the name that goes on the events you add and the
 * &handle a friend would search for. Without it every install is the same
 * person, and the friends, invitations and catch-up features cannot be tried
 * by two people at once.
 *
 * The handle is suggested from the name and can be changed. It is checked
 * against the local directory only, which in the alpha is everyone this phone
 * knows about; the server will have the final say once there is one.
 */
export function IdentityPrompt({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [touchedHandle, setTouchedHandle] = useState(false);

  const effectiveHandle = touchedHandle ? normaliseHandle(handle) : suggestHandle(name);
  const nameOk = name.trim().length >= 2;
  const handleOk = effectiveHandle.length >= 3 && handleAvailable(effectiveHandle);
  const taken = effectiveHandle.length >= 3 && !handleAvailable(effectiveHandle);

  return (
    <Modal visible animationType="fade" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}
      >
        <View
          style={{
            backgroundColor: t.color.bg,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: space.lg,
            paddingBottom: space.xxl,
            gap: space.md,
          }}
        >
          <Text style={{ ...type.heading, color: t.color.text }}>
            What should people call you?
          </Text>
          <Muted>
            This goes on the plans you add. Nothing leaves this phone in the
            alpha.
          </Muted>

          <TextField
            value={name}
            onChange={setName}
            placeholder="Your name"
            autoCapitalize="words"
            maxLength={40}
          />

          <TextField
            value={touchedHandle ? handle : effectiveHandle}
            onChange={(v) => {
              setTouchedHandle(true);
              setHandle(v);
            }}
            prefix="&"
            placeholder="handle"
            autoCapitalize="none"
            maxLength={24}
          />
          <Muted>
            {taken
              ? `&${effectiveHandle} is taken. Try another.`
              : "Your &handle is how friends find you. Letters, numbers, dots and underscores."}
          </Muted>

          <PrimaryButton
            label="That's me"
            disabled={!nameOk || !handleOk}
            onPress={() => {
              setIdentity(name, effectiveHandle);
              onDone();
            }}
          />

          <Pressable
            onPress={() => {
              // "Later" still needs a name for the events they add, so it
              // takes the placeholder the rest of the app would have used
              // and lets Profile fix it.
              setIdentity("You", `you${Math.floor(Math.random() * 9000 + 1000)}`);
              onDone();
            }}
            accessibilityRole="button"
          >
            <Text
              style={{
                ...type.caption,
                color: t.color.textMuted,
                textAlign: "center",
                paddingVertical: space.sm,
              }}
            >
              Skip for now, I'll do it in Profile
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
