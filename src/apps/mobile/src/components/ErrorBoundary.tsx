import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { reportError, sendFeedback } from "@/lib/feedback";
import { radius, space, type } from "@/theme";

interface State {
  error: Error | null;
}

/**
 * The last line.
 *
 * A render error in a release build is a white screen with no way back except
 * a force quit, and a tester who hits one twice stops opening the app. This
 * catches it, reports it, says so in plain words, and offers the two things
 * that help: try again, and tell us.
 *
 * A class component because React only lets those catch render errors; the
 * rest of the app is functions and this is the one exception. It is styled
 * without the theme hook for the same reason - hooks are not available here -
 * so the palette is the light one, hard-coded, which is acceptable for a
 * screen that should never be seen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: space.xl,
          gap: space.md,
          backgroundColor: "#F4F6FA",
        }}
      >
        <Text style={{ ...type.heading, color: "#12141A" }}>
          Something went wrong
        </Text>
        <Text style={{ ...type.body, color: "#5A6072" }}>
          Not your fault. Nothing you added is lost: it is all still on this
          phone.
        </Text>
        <Text
          style={{ ...type.caption, color: "#9AA0B1", fontFamily: "Menlo" }}
          numberOfLines={3}
        >
          {this.state.error.message}
        </Text>

        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          style={{
            alignItems: "center",
            paddingVertical: space.lg - 2,
            borderRadius: radius.pill,
            backgroundColor: "#4C6FFF",
            marginTop: space.md,
          }}
        >
          <Text style={{ ...type.label, fontSize: 16, color: "#fff" }}>Try again</Text>
        </Pressable>

        <Pressable
          onPress={() => void sendFeedback(this.state.error?.message)}
          accessibilityRole="button"
          style={{ alignItems: "center", paddingVertical: space.md }}
        >
          <Text style={{ ...type.label, color: "#4C6FFF" }}>Tell us what happened</Text>
        </Pressable>
      </View>
    );
  }
}
