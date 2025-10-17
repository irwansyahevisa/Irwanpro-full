import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button, TextInput, ScrollView, Alert, TouchableOpacity, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Permissions from 'expo-permissions';

// ---------- Utility functions ----------
function ema(values, period) {
  if (!values || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    if (i === 0) {
      prev = price;
      out.push(prev);
    } else {
      const cur = price * k + prev * (1 - k);
      out.push(cur);
      prev = cur;
    }
  }
  return out;
}

function findSwingHighLow(candles, lookback = 100) {
  if (!candles || candles.length === 0) return null;
  const arr = candles.slice(-lookback);
  let high = -Infinity, low = Infinity, highIdx = -1, lowIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].high > high) { high = arr[i].high; highIdx = i; }
    if (arr[i].low < low) { low = arr[i].low; lowIdx = i; }
  }
  return { high, low, highIdx, lowIdx };
}

function fibLevels(high, low) {
  const diff = high - low;
  const levels = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  return levels.map(l => ({ ratio: l, price: high - diff * l }));
}

function generateSignal(candles, emaFastPeriod = 8, emaMedPeriod = 13, emaSlowPeriod = 21) {
  if (!candles || candles.length < emaSlowPeriod + 5) return null;
  const closes = candles.map(c => c.close);
  const emaFast = ema(closes, emaFastPeriod);
  const emaMed = ema(closes, emaMedPeriod);
  const emaSlow = ema(closes, emaSlowPeriod);

  const lastIndex = closes.length - 1;
  const lastClose = closes[lastIndex];

  const bullish = emaFast[lastIndex] > emaMed[lastIndex] && emaMed[lastIndex] > emaSlow[lastIndex];
  const bearish = emaFast[lastIndex] < emaMed[lastIndex] && emaMed[lastIndex] < emaSlow[lastIndex];

  const swing = findSwingHighLow(candles, 60);
  if (!swing) return null;
  const fibs = fibLevels(swing.high, swing.low);

  const tolerance = (swing.high - swing.low) * 0.01;
  const nearFib = fibs.find(f => Math.abs(lastClose - f.price) <= tolerance && (f.ratio !== 0 && f.ratio !== 1));

  if (bullish && nearFib) {
    return {
      type: 'BUY',
      reason: `EMA trend bullish and price retraced to fib ${nearFib.ratio}`,
      fib: nearFib,
      emas: { fast: emaFast[lastIndex], med: emaMed[lastIndex], slow: emaSlow[lastIndex] },
      price: lastClose,
      timestamp: candles[lastIndex].time
    };
  }
  if (bearish && nearFib) {
    return {
      type: 'SELL',
      reason: `EMA trend bearish and price retraced to fib ${nearFib.ratio}`,
      fib: nearFib,
      emas: { fast: emaFast[lastIndex], med: emaMed[lastIndex], slow: emaSlow[lastIndex] },
      price: lastClose,
      timestamp: candles[lastIndex].time
    };
  }

  const prevIndex = lastIndex - 1;
  const crossUp = emaFast[prevIndex] <= emaMed[prevIndex] && emaFast[lastIndex] > emaMed[lastIndex];
  const crossDown = emaFast[prevIndex] >= emaMed[prevIndex] && emaFast[lastIndex] < emaMed[lastIndex];
  if (crossUp) return { type: 'BUY', reason: 'EMA fast crossed above EMA med', price: lastClose, timestamp: candles[lastIndex].time };
  if (crossDown) return { type: 'SELL', reason: 'EMA fast crossed below EMA med', price: lastClose, timestamp: candles[lastIndex].time };

  return null;
}

async function appendLogCsv(filename, row) {
  try {
    const dir = FileSystem.documentDirectory;
    const path = dir + filename;
    const exists = await FileSystem.getInfoAsync(path);
    const line = Object.values(row).join(',') + '\\n';
    if (!exists.exists) {
      const header = Object.keys(row).join(',') + '\\n';
      await FileSystem.writeAsStringAsync(path, header + line, { encoding: FileSystem.EncodingType.UTF8 });
    } else {
      await FileSystem.writeAsStringAsync(path, line, { encoding: FileSystem.EncodingType.UTF8, append: true });
    }
    return path;
  } catch (e) {
    console.warn('CSV write error', e);
    return null;
  }
}

async function checkNewsFilter(symbol) {
  // Placeholder: always return true. Replace with API call to economic calendar.
  return true;
}

// ---------- Fake candles for testing ----------
function generateFakeCandles(n = 200, startPrice = 1900.00) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const open = price;
    const change = (Math.random() - 0.5) * 4; // simulate XAUUSD volatility
    const close = +(open + change).toFixed(2);
    const high = Math.max(open, close) + Math.random() * 1.2;
    const low = Math.min(open, close) - Math.random() * 1.2;
    const time = Date.now() - (n - i) * 60 * 60 * 1000;
    candles.push({ time, open, high, low, close });
    price = close;
  }
  return candles;
}

// --------- Notifications setup (Expo) ---------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [symbol, setSymbol] = useState('XAUUSD'); // default chosen
  const [candles, setCandles] = useState(generateFakeCandles(300, 1900.00));
  const [signal, setSignal] = useState(null);
  const [logPath, setLogPath] = useState(null);
  const [emaFast, setEmaFast] = useState('8');
  const [emaMed, setEmaMed] = useState('13');
  const [emaSlow, setEmaSlow] = useState('21');
  const [autoScan, setAutoScan] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(true); // default enabled

  useEffect(() => {
    // register for push notifications on app load (local notifications only here)
    (async () => {
      if (Platform.OS !== 'web') {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
      }
    })();
  }, []);

  useEffect(() => {
    let t;
    if (autoScan) {
      t = setInterval(async () => {
        const newCandles = [...candles];
        const last = newCandles[newCandles.length - 1];
        const newPrice = +(last.close + (Math.random() - 0.5) * 1.5).toFixed(2);
        const newCandle = { time: Date.now(), open: last.close, high: Math.max(last.high, newPrice), low: Math.min(last.low, newPrice), close: newPrice };
        newCandles.push(newCandle);
        if (newCandles.length > 500) newCandles.shift();
        setCandles(newCandles);

        const okNews = await checkNewsFilter(symbol);
        if (!okNews) return;

        const s = generateSignal(newCandles, parseInt(emaFast), parseInt(emaMed), parseInt(emaSlow));
        setSignal(s);
        if (s) {
          const path = await appendLogCsv('irwanpro_signals.csv', { time: new Date(s.timestamp).toISOString(), symbol, type: s.type, price: s.price, reason: s.reason });
          if (path) setLogPath(path);
          if (notifyEnabled) {
            await Notifications.scheduleNotificationAsync({
              content: { title: `Signal ${s.type} — ${symbol}`, body: `${s.reason} @ ${s.price}`, sound: 'default' },
              trigger: null,
            });
          }
        }
      }, 3000);
    }
    return () => clearInterval(t);
  }, [autoScan, candles, symbol, emaFast, emaMed, emaSlow, notifyEnabled]);

  const onManualScan = async () => {
    const okNews = await checkNewsFilter(symbol);
    if (!okNews) {
      Alert.alert('News Filter', 'Major news detected — skip signals');
      return;
    }
    const s = generateSignal(candles, parseInt(emaFast), parseInt(emaMed), parseInt(emaSlow));
    setSignal(s);
    if (s) {
      const path = await appendLogCsv('irwanpro_signals.csv', { time: new Date(s.timestamp).toISOString(), symbol, type: s.type, price: s.price, reason: s.reason });
      if (path) setLogPath(path);
      if (notifyEnabled) {
        await Notifications.scheduleNotificationAsync({
          content: { title: `Signal ${s.type} — ${symbol}`, body: `${s.reason} @ ${s.price}`, sound: 'default' },
          trigger: null,
        });
      }
      Alert.alert('Signal generated', `${s.type} — ${s.reason}\nPrice: ${s.price}`);
    } else {
      Alert.alert('No signal', 'No valid signal detected');
    }
  };

  const importCsvSample = async () => {
    const sample = generateFakeCandles(400, 1895.00);
    setCandles(sample);
    Alert.alert('Imported', 'Sample candles loaded');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>IrwanPro Mobile — Full Prototype</Text>
      <View style={styles.row}>
        <Text>Symbol:</Text>
        <TextInput style={styles.input} value={symbol} onChangeText={setSymbol} />
        <TouchableOpacity style={styles.btn} onPress={() => setAutoScan(!autoScan)}>
          <Text style={styles.btnText}>{autoScan ? 'Stop Auto' : 'Start Auto'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.rowSmall}>
        <Text>EMA Fast</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={emaFast} onChangeText={setEmaFast} />
        <Text>EMA Med</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={emaMed} onChangeText={setEmaMed} />
        <Text>EMA Slow</Text>
        <TextInput style={styles.inputSmall} keyboardType="numeric" value={emaSlow} onChangeText={setEmaSlow} />
      </View>

      <View style={{ marginTop: 10 }}>
        <Button title="Manual Scan" onPress={onManualScan} />
        <View style={{ height: 8 }} />
        <Button title="Load Sample Candles" onPress={importCsvSample} />
      </View>

      <View style={styles.row}>
        <Text>Notifications:</Text>
        <TouchableOpacity style={[styles.btnSmall, notifyEnabled ? styles.btnOn : styles.btnOff]} onPress={() => setNotifyEnabled(!notifyEnabled)}>
          <Text style={{color:'#fff'}}>{notifyEnabled ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.signalBox}>
        <Text style={styles.signalTitle}>Latest Signal</Text>
        {signal ? (
          <View>
            <Text>Type: {signal.type}</Text>
            <Text>Price: {signal.price}</Text>
            <Text>Reason: {signal.reason}</Text>
            <Text>Time: {new Date(signal.timestamp).toLocaleString()}</Text>
          </View>
        ) : (
          <Text>No signal yet</Text>
        )}
      </View>

      <ScrollView style={styles.logs}>
        <Text style={{ fontWeight: 'bold' }}>App notes / next steps:</Text>
        <Text>- Integrate a reliable price feed API (broker REST / websocket) for live candles.</Text>
        <Text>- Replace news filter placeholder with an economic calendar API.</Text>
        <Text>- For real order execution, implement a server-side bridge to MT4/MT5.</Text>
        <Text>- Build APK via Expo.dev (EAS) or use Snack for quick tests.</Text>
        <Text>Log file: {logPath || 'not created yet'}</Text>
      </ScrollView>
    </View>
  );
}

const styles = {
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginTop: 20 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 6, width: 120, marginLeft: 8, marginRight: 8 },
  btn: { backgroundColor: '#2b7', padding: 8, borderRadius: 6 },
  btnText: { color: '#fff' },
  rowSmall: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  inputSmall: { borderWidth: 1, borderColor: '#ccc', padding: 4, width: 50, marginLeft: 6, marginRight: 12 },
  btnSmall: { padding: 6, borderRadius: 6, marginLeft: 8 },
  btnOn: { backgroundColor: '#28a745' },
  btnOff: { backgroundColor: '#6c757d' },
  signalBox: { marginTop: 16, width: '100%', padding: 12, borderWidth: 1, borderColor: '#eee' },
  signalTitle: { fontWeight: 'bold', marginBottom: 6 },
  logs: { marginTop: 12, width: '100%', borderTopWidth: 1, borderColor: '#f0f0f0', paddingTop: 8 }
};
