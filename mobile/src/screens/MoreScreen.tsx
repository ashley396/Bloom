import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

type MoreStackParamList = {
  MoreMenu: undefined;
  WebsiteStudio: undefined;
};

type Props = NativeStackScreenProps<MoreStackParamList, "MoreMenu">;

/** Drawer entry — mirrors web "More" tab (full sidebar navigation). */
export function MoreScreen({ navigation }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>More</Text>
      <Text style={styles.sub}>Reports, Website Studio, Settings, Wholesale, and all shop tools.</Text>
      <Pressable style={styles.link} onPress={() => navigation.navigate("WebsiteStudio")}>
        <Text style={styles.linkText}>Website Studio</Text>
        <Text style={styles.linkSub}>Publish status, SEO scores, domain verification</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", color: "#1a2b48" },
  sub: { marginTop: 8, color: "#5a4a52" },
  link: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f8f3f6",
    borderWidth: 1,
    borderColor: "#e8e0e4",
    minHeight: 44,
  },
  linkText: { fontSize: 17, fontWeight: "600", color: "#8f3f68" },
  linkSub: { marginTop: 4, fontSize: 13, color: "#5a4a52" },
});
