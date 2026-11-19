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

/**
 * Used once, by the person who starts the tree. It needs the setup secret that was
 * saved when the server was put online. After the first person exists it stops working.
 */
export default function StartTree() {
  const { signIn } = useAuth();
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<(typeof GENDERS)[number]["value"]>("male");
  const [birth, setBirth] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api(null).setup(secret.trim(), { full_name: name, gender, birth_year: birth ? Number(birth) : null }, login, password);
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
      <Kicker>ONE TIME ONLY</Kicker>
      <Title>Start the tree</Title>
      <Body muted>
        This makes the very first person in the tree. Enter the setup secret you saved in GitHub. Once the first person
        exists, this page stops working and everyone else joins with "Join the tree".
      </Body>
      <Card>
        <Field label="Setup secret" value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" />
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
        <Field label="Choose a password (8 or more characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <ErrorText>{error}</ErrorText>
        <Button title="Start the tree" onPress={submit} busy={busy} disabled={!secret.trim() || !name.trim() || !login || password.length < 8} />
      </Card>
    </Screen>
  );
}
