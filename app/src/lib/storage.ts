import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Phones keep the sign-in token in the secure keychain; the website uses the browser's storage.
const KEY = "onefamily.session";

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
    } catch {
      // Private browsing can block storage; the user just signs in again next time.
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}
