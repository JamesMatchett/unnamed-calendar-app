import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { PrimaryButton, TextField } from "@/components/form";
import { Muted } from "@/components/ui";
import {
  handleAvailable,
  normaliseHandle,
  setAppearance,
  setAuthProvider,
  setIdentity,
  suggestHandle,
} from "@/db/repo";
import type { Provider } from "@/lib/auth";
import { PROVIDER_LABEL, providersFor, signIn } from "@/lib/auth";
import { LOCAL_ONLY } from "@/config";
import type { Appearance } from "@/theme";
import { radius, space, type, useTheme } from "@/theme";

/**
 * The four things worth showing before anyone has any data of their own.
 *
 * Each is a thing the app does that a calendar app usually does not, in the
 * order somebody meets them: everything together, answering, deciding together,
 * and the one that needs two people. The pictures are drawn by
 * tools/onboarding.py from the app's own tokens rather than screenshotted, so
 * they cannot go stale against a corner radius.
 */
const SLIDES = [
  {
    key: "one-place",
    image: require("../../assets/onboarding/one-place.png"),
    title: "Everything, in one place",
    body: "Every calendar you are part of, in one list, in the order it happens.",
  },
  {
    key: "everyone-answers",
    image: require("../../assets/onboarding/everyone-answers.png"),
    title: "One tap to answer",
    body: "Going, maybe or can't, from the list. Everyone can see who is actually coming.",
  },
  {
    key: "pick-together",
    image: require("../../assets/onboarding/pick-together.png"),
    title: "Pick a date together",
    body: "Put a few evenings up and let people answer, instead of guessing for everyone.",
  },
  {
    key: "both-free",
    image: require("../../assets/onboarding/both-free.png"),
    title: "Find a time you are both free",
    body: "Cal&der works out the gaps in two calendars, so nobody has to negotiate by message.",
  },
] as const;

type Step = "welcome" | "signin" | "identity" | "appearance";

/**
 * The first open (§3.5).
 *
 * One flow rather than three sheets in a row: welcome, how you get in, who you
 * are, how it looks. It ends with a person who has a name, a handle and a
 * calendar of their own, which is the least you can have and still be able to
 * do anything.
 *
 * The appearance step is last and previews live, so the choice is made against
 * an app that already has their name in it.
 */
export function Onboarding({
  appearance,
  onPreviewAppearance,
}: {
  /** The appearance being previewed while the last step is open. */
  appearance: Appearance;
  onPreviewAppearance: (next: Appearance) => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState<Provider | null>(null);

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      {step === "welcome" ? <Welcome onNext={() => setStep("signin")} /> : null}
      {step === "signin" ? (
        <SignIn
          onBack={() => setStep("welcome")}
          onPicked={(p) => {
            setProvider(p);
            setStep("identity");
          }}
        />
      ) : null}
      {step === "identity" ? (
        <Identity provider={provider} onDone={() => setStep("appearance")} />
      ) : null}
      {step === "appearance" ? (
        <AppearanceStep value={appearance} onPreview={onPreviewAppearance} />
      ) : null}
    </Modal>
  );
}

// --- 1. welcome ---------------------------------------------------------------

function Welcome({ onNext }: { onNext: () => void }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  // The slide is sized from the window rather than fixed, so it is not a
  // postage stamp on a Pro Max or clipped on an SE.
  const cardWidth = Math.min(width - space.xl * 4, 300);

  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg, paddingTop: space.xxl * 2 }}>
      <View style={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.xl }}>
        <Text style={{ ...type.title, fontSize: 32, color: t.color.text }}>
          Welcome to Cal&amp;der
        </Text>
        {/* The ampersand is the mark, and this is how it reads out loud. It is
            also the domain, which is the other thing people ask. */}
        <Text style={{ ...type.body, color: t.color.textMuted, letterSpacing: 1 }}>
          Calandder
        </Text>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        style={{ flexGrow: 0, marginTop: space.lg }}
      >
        {SLIDES.map((slide) => (
          <View
            key={slide.key}
            style={{ width, alignItems: "center", paddingHorizontal: space.xl, gap: space.lg }}
          >
            <Image
              source={slide.image}
              accessibilityIgnoresInvertColors
              accessibilityLabel={slide.title}
              style={{
                width: cardWidth,
                height: cardWidth * (900 / 560),
                borderRadius: radius.lg,
                // The drawn screen has its own light ground, so on a dark theme
                // it needs an edge or it floats.
                borderWidth: t.dark ? 1 : 0,
                borderColor: t.color.border,
              }}
              resizeMode="contain"
            />
            <View style={{ gap: space.xs, alignItems: "center" }}>
              <Text
                style={{ ...type.heading, fontSize: 19, color: t.color.text, textAlign: "center" }}
              >
                {slide.title}
              </Text>
              <Text
                style={{
                  ...type.body,
                  fontSize: 15,
                  color: t.color.textMuted,
                  textAlign: "center",
                }}
              >
                {slide.body}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          gap: 6,
          justifyContent: "center",
          paddingVertical: space.lg,
        }}
      >
        {SLIDES.map((slide, i) => (
          <View
            key={slide.key}
            style={{
              width: i === page ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === page ? t.color.accent : t.color.border,
            }}
          />
        ))}
      </View>

      <View style={{ marginTop: "auto", padding: space.lg, gap: space.sm }}>
        <PrimaryButton label="Get started" onPress={onNext} />
      </View>
    </View>
  );
}

// --- 2. how you get in --------------------------------------------------------

const BUTTONS: Record<
  Provider,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  apple: { label: "Sign in with Apple", icon: "logo-apple" },
  google: { label: "Sign in with Google", icon: "logo-google" },
  email: { label: "Sign in with email", icon: "mail-outline" },
};

function SignIn({
  onBack,
  onPicked,
}: {
  onBack: () => void;
  onPicked: (provider: Provider) => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState<Provider | null>(null);

  const choose = async (provider: Provider) => {
    setBusy(provider);
    try {
      const account = await signIn(provider);
      if (!account) return; // They backed out of the provider's own sheet.
      setAuthProvider(provider);
      onPicked(provider);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg, padding: space.lg }}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{ paddingTop: space.xxl, paddingBottom: space.lg }}
      >
        <Ionicons name="chevron-back" size={26} color={t.color.text} />
      </Pressable>

      <View style={{ gap: space.xs, paddingBottom: space.xl }}>
        <Text style={{ ...type.title, color: t.color.text }}>Get started</Text>
        <Text style={{ ...type.body, color: t.color.textMuted }}>
          One account, so your plans follow you to a new phone and your friends
          can find you.
        </Text>
      </View>

      <View style={{ gap: space.md }}>
        {providersFor().map((provider) => {
          const { label, icon } = BUTTONS[provider];
          // Apple's button is black on white and white on black, and is the one
          // whose look is not ours to invent. Google's is a light surface with
          // a border. Email is ours, so it takes the app's own outline.
          const dark = provider === "apple";
          const background = dark
            ? t.dark
              ? "#FFFFFF"
              : "#000000"
            : t.color.surface;
          const foreground = dark
            ? t.dark
              ? "#000000"
              : "#FFFFFF"
            : t.color.text;

          return (
            <Pressable
              key={provider}
              onPress={() => void choose(provider)}
              disabled={busy !== null}
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: space.sm,
                paddingVertical: space.lg - 2,
                borderRadius: radius.pill,
                backgroundColor: background,
                borderWidth: dark ? 0 : 1,
                borderColor: t.color.border,
                opacity: busy !== null && busy !== provider ? 0.5 : 1,
              }}
            >
              <Ionicons name={icon} size={19} color={foreground} />
              <Text style={{ ...type.label, fontSize: 16, color: foreground }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {LOCAL_ONLY ? (
        <View
          style={{
            flexDirection: "row",
            gap: space.md,
            alignItems: "flex-start",
            marginTop: space.xl,
            padding: space.lg,
            borderRadius: radius.md,
            backgroundColor: t.color.surfaceAlt,
          }}
        >
          <Ionicons name="flask-outline" size={18} color={t.color.textMuted} />
          <Text style={{ ...type.caption, flex: 1, color: t.color.textMuted }}>
            Accounts arrive with the next build. In this alpha whichever you pick
            keeps everything on this phone, and asks you for a name on the next
            screen.
          </Text>
        </View>
      ) : null}

      <Muted>
        {"\n"}By continuing you agree to be one of the first people to use this,
        which mostly means telling us when it is wrong.
      </Muted>
    </View>
  );
}

// --- 3. who you are -----------------------------------------------------------

function Identity({
  provider,
  onDone,
}: {
  provider: Provider | null;
  onDone: () => void;
}) {
  const t = useTheme();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [touchedHandle, setTouchedHandle] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const effectiveHandle = touchedHandle ? normaliseHandle(handle) : suggestHandle(name);
  const nameOk = name.trim().length >= 2;
  const free = effectiveHandle.length >= 3 && handleAvailable(effectiveHandle);
  const taken = effectiveHandle.length >= 3 && !handleAvailable(effectiveHandle);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.color.bg }}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.xxl * 2, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xs, paddingBottom: space.md }}>
          <Text style={{ ...type.title, color: t.color.text }}>
            What should people call you?
          </Text>
          <Text style={{ ...type.body, color: t.color.textMuted }}>
            This goes on the plans you add.
            {provider && LOCAL_ONLY
              ? ` Once accounts are live, ${PROVIDER_LABEL[provider]} will fill this in for you.`
              : ""}
          </Text>
        </View>

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

        <View style={{ paddingTop: space.md }}>
          <PrimaryButton
            label="That's me"
            disabled={!nameOk || !free}
            onPress={() => {
              setIdentity(name, effectiveHandle);
              onDone();
            }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// --- 4. how it looks ----------------------------------------------------------

const APPEARANCE_CHOICES: {
  value: Appearance;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: "system",
    label: "Match my phone",
    detail: "Follows your phone's own light and dark setting.",
    icon: "phone-portrait-outline",
  },
  { value: "light", label: "Always light", detail: "", icon: "sunny-outline" },
  { value: "dark", label: "Always dark", detail: "", icon: "moon-outline" },
];

/**
 * Last, and previewing live: the choice is about how it looks, so the honest
 * preview is the app itself, already carrying their name.
 *
 * "Match my phone" leads and is the default, because it is the only answer that
 * keeps being right when they change their mind at the OS level.
 */
function AppearanceStep({
  value,
  onPreview,
}: {
  value: Appearance;
  onPreview: (next: Appearance) => void;
}) {
  const t = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg, padding: space.lg }}>
      <View style={{ gap: space.xs, paddingTop: space.xxl * 2, paddingBottom: space.lg }}>
        <Text style={{ ...type.title, color: t.color.text }}>Light or dark?</Text>
        <Text style={{ ...type.body, color: t.color.textMuted }}>
          Tap one to see it. You can change this any time in settings.
        </Text>
      </View>

      <View style={{ gap: space.sm }}>
        {APPEARANCE_CHOICES.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              key={choice.value}
              onPress={() => onPreview(choice.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.lg,
                borderRadius: radius.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? t.color.accent : t.color.border,
                backgroundColor: selected ? t.color.accentSoft : t.color.surface,
              }}
            >
              <Ionicons
                name={choice.icon}
                size={20}
                color={selected ? t.color.accent : t.color.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    ...type.body,
                    fontWeight: selected ? "600" : "400",
                    color: selected ? t.color.accent : t.color.text,
                  }}
                >
                  {choice.label}
                </Text>
                {choice.detail ? (
                  <Text style={{ ...type.caption, color: t.color.textMuted }}>
                    {choice.detail}
                  </Text>
                ) : null}
              </View>
              {selected ? (
                <Ionicons name="checkmark" size={18} color={t.color.accent} />
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: "auto", gap: space.sm }}>
        <PrimaryButton
          // Whatever is being previewed is the answer, including the default
          // nobody touched: there is no way out of here without having decided.
          label="Start planning"
          onPress={() => setAppearance(value)}
        />
      </View>
    </View>
  );
}
