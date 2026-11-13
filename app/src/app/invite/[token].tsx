import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { api, type TreePerson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Body, Button, Card, ErrorText, Field, Kicker, Loading, Screen, Title } from "@/components/ui";

export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { signIn } = useAuth();
  const [info, setInfo] = useState<{ person: TreePerson; invitedBy: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api(null).getInvite(token).then(setInfo).catch((e) => setLoadError((e as Error).message));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const r = await api(null).acceptInvite(token!, login, password);
      await signIn(r.token);
      router.replace("/inbox");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Screen>
        <Title>This link can't be used</Title>
        <Body muted>{loadError} Ask the relative who invited you to send a new link.</Body>
      </Screen>
    );
  }
  if (!info) return <Loading />;

  return (
    <Screen>
      <Kicker>YOU'RE INVITED</Kicker>
      <Title>Welcome, {info.person.full_name}</Title>
      <Body>
        {info.invitedBy} added you to the One Family tree. Choose how you'll sign in, then you can check the
        relations waiting for you and add your own family.
      </Body>
      <Card>
        <Field label="Your email or phone number" value={login} onChangeText={setLogin} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
        <Field label="Choose a password (8 or more characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <ErrorText>{error}</ErrorText>
        <Button title="Join the tree" onPress={accept} busy={busy} disabled={!login || password.length < 8} />
      </Card>
    </Screen>
  );
}
