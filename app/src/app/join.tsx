import { useState } from "react";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Body, Button, Card, Choice, ErrorText, Field, Kicker, Screen, Title } from "@/components/ui";

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
] as const;

/** Sign up without an invite. Relatives confirm who you are afterwards. */
export default function Join() {
  const { signIn } = useAuth();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<(typeof GENDERS)[number]["value"]>("female");
  const [birth, setBirth] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api(null).signUp({ full_name: name, gender, birth_year: birth ? Number(birth) : null }, login, password);
      await signIn(r.token);
      router.replace("/find");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Kicker>JOIN ONE FAMILY</Kicker>
      <Title>Join the tree</Title>
      <Body muted>
        After signing up, you'll find yourself or a relative in the tree. A relative who has already joined then
        confirms it's really you.
      </Body>
      <Card>
        <Field label="Your full name" value={name} onChangeText={setName} autoComplete="name" />
        <Choice label="Gender" options={[...GENDERS]} value={gender} onChange={setGender} />
        <Field label="Birth year (optional)" value={birth} onChangeText={setBirth} keyboardType="number-pad" maxLength={4} />
        <Field
          label="Email or phone number"
          value={login}
          onChangeText={setLogin}
          autoCapitalize="none"
          autoComplete="username"
          keyboardType="email-address"
        />
        <Body muted>Your relatives will see part of it, so they can recognise you.</Body>
        <Field label="Choose a password (8 or more characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <ErrorText>{error}</ErrorText>
        <Button title="Sign up" onPress={submit} busy={busy} disabled={!name.trim() || !login || password.length < 8} />
      </Card>
      <Button kind="secondary" title="I already have an account" onPress={() => router.replace("/welcome")} />
    </Screen>
  );
}
