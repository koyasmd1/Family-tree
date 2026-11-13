import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Body, Button, Card, ErrorText, Field, Kicker, Screen, Title } from "@/components/ui";
import { SeedToTree } from "@/components/animations";
import { NorthernGlow } from "@/components/moments";

export default function Welcome() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api(null).login(login, password);
      await signIn(r.token);
      router.replace("/tree");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: 24 }}>
        <SeedToTree />
      </View>
      <NorthernGlow style={{ gap: 8, paddingVertical: 12 }}>
        <Kicker>ONE FAMILY</Kicker>
        <Title>Everyone on earth, one family tree.</Title>
      </NorthernGlow>
      <Body muted>
        Joining is by invitation. A relative who is already in the tree adds you and sends you a link. Already a
        member? Sign in below.
      </Body>
      <Card>
        <Field label="Email or phone number" value={login} onChangeText={setLogin} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
        <ErrorText>{error}</ErrorText>
        <Button title="Sign in" onPress={submit} busy={busy} disabled={!login || !password} />
      </Card>
    </Screen>
  );
}
