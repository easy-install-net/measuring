import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, COLLECTIONS } from "./firebase-init.js";

// 預設標準字典（首次啟動自動寫入雲端，日後可隨時修改）
export const DEFAULT_MASTER_DICT = {
  spaceGroups: [
    {
      group: "公共與起居",
      items: [
        { name: "總圖", pinned: true },
        { name: "平面圖", pinned: false },
        { name: "玄關", pinned: true },
        { name: "客廳", pinned: false },
        { name: "飯廳", pinned: false },
        { name: "吧檯", pinned: false },
        { name: "閱讀區", pinned: false }
      ]
    },
    {
      group: "睡房與書房",
      items: [
        { name: "主臥", pinned: true },
        { name: "臥2", pinned: false },
        { name: "客房", pinned: false },
        { name: "兒童房", pinned: true },
        { name: "書房", pinned: false }
      ]
    },
    {
      group: "衛浴與廚務",
      items: [
        { name: "廚房", pinned: false },
        { name: "主臥衛浴", pinned: false },
        { name: "客浴", pinned: false },
        { name: "淋浴間", pinned: false }
      ]
    },
    {
      group: "收納、家務與特色空間",
      items: [
        { name: "更衣室", pinned: false },
        { name: "衣帽間", pinned: false },
        { name: "儲藏室", pinned: false },
        { name: "家務室", pinned: false },
        { name: "洗衣間", pinned: false },
        { name: "走廊", pinned: false },
        { name: "走道", pinned: false },
        { name: "陽台", pinned: false },
        { name: "露台", pinned: false },
        { name: "閣樓", pinned: true },
        { name: "工人房", pinned: true }
      ]
    }
  ],

  cabinetGroups: [
    {
      group: "客廳及玄關櫃",
      items: [
        { name: "C字櫃", pinned: true },
        { name: "電視櫃", pinned: true },
        { name: "鞋櫃", pinned: true },
        { name: "飾物櫃", pinned: false },
        { name: "變形傢俬", pinned: false }
      ]
    },
    {
      group: "睡房床組類",
      items: [
        { name: "地台床", pinned: true },
        { name: "榻榻米", pinned: true },
        { name: "子母床", pinned: true },
        { name: "兒童床", pinned: false },
        { name: "組合床", pinned: false },
        { name: "油壓床", pinned: false },
        { name: "變形床", pinned: false },
        { name: "訂造床褥", pinned: false }
      ]
    },
    {
      group: "間房、門類及廚廁櫃",
      items: [
        { name: "間房櫃", pinned: true },
        { name: "暗門左右櫃", pinned: true },
        { name: "玻璃趟門訂造", pinned: true },
        { name: "木趟門訂造", pinned: true },
        { name: "衣櫃", pinned: false },
        { name: "廚櫃", pinned: false },
        { name: "浴室櫃", pinned: false }
      ]
    }
  ],

  rulerColors: [
    { id: "black", name: "純黑（主尺寸）", hex: "#111827" },
    { id: "blue",  name: "工程藍（細部）", hex: "#1D4ED8" },
    { id: "green", name: "翠綠（水電位）", hex: "#15803D" },
    { id: "purple",name: "深紫（收口位）", hex: "#6D28D9" },
    { id: "red",   name: "警示紅（異常）", hex: "#DC2626" }
  ],

  quickTags: ["電掣位", "燈曲位", "冷氣去水喉", "橫樑底", "門框邊", "地腳線", "牆身不平", "批盪凸出"],

  checklists: {
    "地台床": ["確認窗台石高度及深度", "確認房門打開後門底淨空高度", "量度床頭電掣離地高度"],
    "榻榻米": ["確認窗台石高度及深度", "確認地腳線厚度"],
    "玻璃趟門訂造": ["量度門洞上中下三點淨闊", "檢查天地路軌水平及橫樑承重"],
    "木趟門訂造": ["量度門洞上中下三點淨闊", "確認牆身垂直度及門套厚度"],
    "間房櫃": ["量度天花橫樑底淨高", "確認兩側牆身上下垂直度誤差"],
    "暗門左右櫃": ["確認門框淨闊與門鉸開啟方向", "檢查地腳線及門檻石收口"]
  }
};

export async function loadMasterDict() {
  const ref = doc(db, COLLECTIONS.MASTER_CONFIG, "default_dict");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  } else {
    await setDoc(ref, DEFAULT_MASTER_DICT);
    return DEFAULT_MASTER_DICT;
  }
}

export async function saveMasterDict(updatedDict) {
  const ref = doc(db, COLLECTIONS.MASTER_CONFIG, "default_dict");
  await setDoc(ref, updatedDict, { merge: true });
}
