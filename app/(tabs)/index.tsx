import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from "axios";
import * as SMS from 'expo-sms';
import { Audio } from "expo-av";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { MaterialIcons } from '@expo/vector-icons';
import { Accelerometer } from "expo-sensors";
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View, Animated, Easing, AppState } from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Battery from 'expo-battery';
import { IconSymbol } from '@/components/ui/icon-symbol';
import '../backgroundTask';
import { LOCATION_TASK_NAME } from '../backgroundTask';

const { width, height } = Dimensions.get("window");

const HELPLINES = [
  { id: '1', title: 'National Emergency', num: '112', icon: '🆘' },
  { id: '2', title: 'Ambulance', num: '108', icon: '🚑' },
  { id: '3', title: 'Women Helpline', num: '1091', icon: '👩' },
  { id: '4', title: 'Child Protection', num: '1098', icon: '👶' },
  { id: '5', title: 'Maternal Care', num: '1056', icon: '🍼' },
];

const SHAKE_THRESHOLD = 3.2; 
const SCREAM_THRESHOLD_DB = -5;

export default function App() {
  const [userName, setUserName] = useState("Alpha");
  const [userPin, setUserPin] = useState("1234");
  const [serverIp, setServerIp] = useState("172.17.0.149");
  const [contact1, setContact1] = useState("");
  const [contact2, setContact2] = useState("");
  const [location, setLocation] = useState<any>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showHelplines, setShowHelplines] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [showFakeCall, setShowFakeCall] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [inputPin, setInputPin] = useState("");
  const ringtoneSoundRef = useRef<Audio.Sound | null>(null);
  const [isScreamMonitoring, setIsScreamMonitoring] = useState(false);
  const [videoRecording, setVideoRecording] = useState<any>(null);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [currentAddress, setCurrentAddress] = useState("Fetching address...");

  const locRef = useRef(location);
  const ipRef = useRef(serverIp);
  const nameRef = useRef(userName);
  const contact1Ref = useRef(contact1);
  const contact2Ref = useRef(contact2);
  const appState = useRef(AppState.currentState);
  const lastShakeTime = useRef(0);
  const shakeStartRef = useRef(0);
  const lastScreamTime = useRef(0);
  const screamMonitorRef = useRef<Audio.Recording | null>(null);
  const showFakeCallRef = useRef(showFakeCall);
  const cameraRef = useRef<any>(null);
  const emergencyActiveRef = useRef(false);
  const emergencyTimeRef = useRef("");
  
  // Fake Call Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    locRef.current = location;
    ipRef.current = serverIp;
    nameRef.current = userName;
    contact1Ref.current = contact1;
    contact2Ref.current = contact2;
    showFakeCallRef.current = showFakeCall;
  }, [location, serverIp, userName, showFakeCall, contact1, contact2]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const storedIp = await AsyncStorage.getItem('BACKEND_IP');
        const storedName = await AsyncStorage.getItem('USER_ID');
        const storedPin = await AsyncStorage.getItem('USER_PIN');
        const storedContact1 = await AsyncStorage.getItem('CONTACT_1');
        const storedContact2 = await AsyncStorage.getItem('CONTACT_2');
        const configSaved = await AsyncStorage.getItem('CONFIG_SAVED');
        if (storedName) setUserName(storedName);
        if (storedPin) setUserPin(storedPin);
        if (storedIp) setServerIp(storedIp);
        if (storedContact1) setContact1(storedContact1);
        if (storedContact2) setContact2(storedContact2);
        
        if (configSaved === 'true') {
          setShowConfig(false);
        }
      } catch (e) {
        console.error("Failed to load config", e);
      }
    };
    loadConfig();

    return () => {
      Accelerometer.removeAllListeners();
      stopScreamMonitor();
      if (ringtoneSoundRef.current) ringtoneSoundRef.current.unloadAsync();
    };
  }, []);

  useEffect(() => {
    // Start Fake Call Animations if active
    if (showFakeCall) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(slideAnim, {
            toValue: 10,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          })
        ])
      ).start();
    }

    const appStateSub = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // Returned to foreground. Resume ringtone if fake call is still pending
        if (showFakeCallRef.current && !ringtoneSoundRef.current) {
           playRingtone();
        }
      }
      appState.current = nextAppState;
    });

    Accelerometer.setUpdateInterval(50); // Faster sampling for 250ms threshold check
    const subscription = Accelerometer.addListener(accelerometerData => {
      if (showConfig) return; // Disregard shakes during setup/QR scan phase
      const { x, y, z } = accelerometerData;
      const currentAcceleration = Math.sqrt(x * x + y * y + z * z);

      if (currentAcceleration > SHAKE_THRESHOLD) {
        const now = Date.now();
        // Prevent overlapping triggers: check debounce (10s) and avoid triggering if call is already showing
        if (now - lastShakeTime.current > 10000 && !showFakeCallRef.current) {
             console.log(`Shake detected: ${currentAcceleration.toFixed(2)}G`);
             console.log("SHAKE SUSTAINED - TRIGGERING SOS");
             lastShakeTime.current = now;
             handleShakeTrigger();
        }
      }
    });

    return () => {
      appStateSub.remove();
      subscription.remove();
    };
  }, [showConfig, showFakeCall]); // Re-bind if config state changes

  const playRingtone = async () => {
    try {
      console.log("Preparing audio engine for ringtone...");
      
      // PAUSE THE SCREAM MONITOR SO IT DOESNT HEAR THE RINGTONE
      if (isScreamMonitoring) {
        await stopScreamMonitor();
      }

      // Ensure audio mode allows playing even in silent mode
      await Audio.setAudioModeAsync({ 
        playsInSilentModeIOS: true, 
        staysActiveInBackground: true, 
        playThroughEarpieceAndroid: false,
        allowsRecordingIOS: false, // Ensure we aren't in recording mode which can lower volume
        shouldDuckAndroid: false,
      });

      if (ringtoneSoundRef.current) {
        await ringtoneSoundRef.current.unloadAsync();
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        require('../../assets/ringtone.mp3'),
        { shouldPlay: false, volume: 1.0, isLooping: true }
      );
      
      ringtoneSoundRef.current = newSound;
      await newSound.playAsync();
      console.log("Ringtone playing successfully!");

      Vibration.vibrate([1000, 2000, 1000, 2000], true); 
    } catch (e) { 
        console.log("Ringtone error", e); 
    }
  };

  const startFakeCall = async () => {
    setShowFakeCall(true);
    await playRingtone();
  };

  const stopFakeCall = async () => {
    setShowFakeCall(false);
    Vibration.cancel();
    if (ringtoneSoundRef.current) {
      await ringtoneSoundRef.current.stopAsync();
      await ringtoneSoundRef.current.unloadAsync();
      ringtoneSoundRef.current = null;
    }
    
    // RESUME SCREAM MONITOR NOW THAT IT IS QUIET
    if (!isRecording && !isVideoRecording) {
        await startScreamMonitor();
    }
  };

  const startScreamMonitor = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') return console.log("Mic access denied for Scream Monitor.");

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const monitorOpts = {
        ...Audio.RecordingOptionsPresets.LOW_QUALITY,
        isMeteringEnabled: true,
      };

      const { recording: r } = await Audio.Recording.createAsync(monitorOpts);
      screamMonitorRef.current = r;

      r.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording && status.metering !== undefined) {
          if (status.metering > SCREAM_THRESHOLD_DB) {
            const now = Date.now();
            if (now - lastScreamTime.current > 8000) {
              lastScreamTime.current = now;
              handleScreamTrigger(status.metering);
            }
          }
        }
      });

      setIsScreamMonitoring(true);
    } catch (err) {
      console.log("Failed to start scream monitor", err);
    }
  };

  const stopScreamMonitor = async () => {
    if (screamMonitorRef.current) {
      try {
        await screamMonitorRef.current.stopAndUnloadAsync();
        screamMonitorRef.current = null;
        setIsScreamMonitoring(false);
      } catch (e) { }
    }
  };

  const handleScreamTrigger = (db: number) => {
    if (!emergencyActiveRef.current) {
      emergencyActiveRef.current = true;
      emergencyTimeRef.current = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    Vibration.vibrate([200, 400, 200, 400]);
    triggerSOS("SCREAM_DETECTED_SOS");
  };

  const handleShakeTrigger = async () => {
    if (emergencyActiveRef.current) {
       Alert.alert("Emergency Active", `Signal already dispatched safely at ${emergencyTimeRef.current}. Live tracking continuous.`);
       if (!showFakeCallRef.current) startFakeCall();
       return;
    }
    
    emergencyActiveRef.current = true;
    emergencyTimeRef.current = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Both SOS alert and Fake Call with ringtone
    await triggerSOS("SHAKE_DETECTED"); 
    startFakeCall();
  };

  const saveConfig = async () => {
    if (!serverIp) return Alert.alert("Error", "Server IP is required");
    await AsyncStorage.setItem('BACKEND_IP', serverIp);
    await AsyncStorage.setItem('USER_ID', userName);
    await AsyncStorage.setItem('USER_PIN', userPin);
    await AsyncStorage.setItem('CONTACT_1', contact1);
    await AsyncStorage.setItem('CONTACT_2', contact2);
    await AsyncStorage.setItem('CONFIG_SAVED', 'true');
    setShowConfig(false);
    initBackgroundTracking();
  };

  const getBackendUrl = () => `http://${ipRef.current}:5000/location`;

  const initBackgroundTracking = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') return Alert.alert("Permission Denied", "Foreground location is required.");

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') return Alert.alert("Warning", "Background location denied. Dead-man switch may trigger if app minimizes.");

      (async () => {
        let curr = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const newLoc = { latitude: curr.coords.latitude, longitude: curr.coords.longitude };
        setLocation(newLoc);
        locRef.current = newLoc;
        
        try {
          const geocode = await Location.reverseGeocodeAsync(newLoc);
          if (geocode.length > 0) {
            const addr = geocode[0];
            setCurrentAddress(`${addr.name || addr.street || ''}, ${addr.city || addr.subregion || ''}`);
          }
        } catch (geoErr) {
          console.log("Geocoding failed", geoErr);
          setCurrentAddress("Live GPS Location");
        }
      })();

      await Location.watchPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 10
      }, async (loc) => {
        const newLoc = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(newLoc);
        locRef.current = newLoc;
        
        // Background reverse geocoding for moving updates
        try {
          const geocode = await Location.reverseGeocodeAsync(newLoc);
          if (geocode.length > 0) {
            const addr = geocode[0];
            setCurrentAddress(`${addr.name || addr.street || ''}, ${addr.city || addr.subregion || ''}`);
          }
        } catch (e) { /* silent fail on moving geocode */ }
      });

      const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (!isRegistered) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,
          distanceInterval: 5,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "SafeBand Active",
            notificationBody: "Live uplink is securely transmitting.",
            notificationColor: "#00cec9",
          }
        });
      }
      setIsConnected(true);

      if (!screamMonitorRef.current && !isRecording) {
        startScreamMonitor();
      }

    } catch (e) {
      console.error("Location INIT error", e);
    }
  };

  useEffect(() => {
    if (!showConfig && serverIp) {
      initBackgroundTracking();
    }
  }, [showConfig, serverIp]);

  const triggerSOS = async (type: string) => {
    console.log(`[SOS] Attempting to trigger: ${type}`);
    try {
      if (!ipRef.current) {
        console.warn("[SOS] Failed: No Server IP configured.");
        return Alert.alert("Config Required", "Please check configuration.");
      }
      
      // Fallback to 0,0 if GPS hasn't locked so the SOS doesn't fail silently
      const coords = locRef.current || { latitude: 0, longitude: 0 };
      const url = getBackendUrl();

      // Fetch actual battery level
      let batteryLevel = 100;
      try {
        const level = await Battery.getBatteryLevelAsync();
        batteryLevel = Math.round(level * 100);
      } catch (batErr) {
        console.warn("Failed to fetch battery level", batErr);
      }

      const payload: any = { userId: nameRef.current, ...coords, battery: batteryLevel, triggerType: type };
      console.log(`[SOS] Sending payload to ${url}:`, payload);

      const response = await axios.post(url, payload, { timeout: 10000 });
      console.log(`[SOS] Server Response:`, response.data);

      // Trigger SMS
      const c1 = contact1Ref.current;
      const c2 = contact2Ref.current;
      const mapLink = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
      
      const isPrioritySOS = type !== "ROUTINE" && type !== "USER_REPORTED_SAFE" && !type.includes("AUDIO") && !type.includes("VIDEO") && type !== "DURESS_SILENT_TRIGGERED";
      
      if (isPrioritySOS && (c1 || c2)) {
         const isAvailable = await SMS.isAvailableAsync();
         if (isAvailable) {
            const numbers = [];
            if (c1) numbers.push(c1);
            if (c2) numbers.push(c2);
            
            try {
               await SMS.sendSMSAsync(
                  numbers,
                  `🚨 EMERGENCY: SafeBand SOS Triggered by ${nameRef.current}!\nType: ${type.replace(/_/g, ' ')}\nLocation: ${mapLink}`
               );
               console.log("[SOS] SMS Dispatch Attempted to", numbers);
            } catch (smsErr) {
               console.error("[SOS] SMS Dispatch Failed:", smsErr);
            }
         }
      }

      if (!type.includes("ROUTINE") && type !== "USER_REPORTED_SAFE" && type !== "AUDIO_EVIDENCE_STORED" && type !== "SHAKE_DETECTED" && type !== "SCREAM_DETECTED_SOS" && type !== "LIVE_AUDIO_STARTED" && type !== "LIVE_VIDEO_STARTED" && type !== "VIDEO_EVIDENCE_STORED") {
        Alert.alert("🚨 SafeBand Uplink", `Priority Signal Transmitted: ${type.replace(/_/g, ' ')}`);
      }
      
      return true; // Resolve for caller
    } catch (e: any) {
      console.error(`[SOS] Network Failure:`, e.message || e);
      if (type !== "SHAKE_DETECTED" && type !== "ROUTINE") {
        Alert.alert("Uplink Failed", `Connectivity issue: ${e.message || 'Check Server IP'}`); 
      }
    }
  };

  const toggleRecording = async () => {
    try {
      if (isScreamMonitoring) { await stopScreamMonitor(); }

      if (recording) {
        setIsRecording(false);
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI(); // GET FILE PATH
        setRecording(null);
        
        triggerSOS("AUDIO_EVIDENCE_STORED");
        if (uri) uploadEvidence(uri, 'audio/m4a'); // UPLINK TO MONITORING STATION

        Alert.alert("Evidence Secured", `File saved locally and transmitted to monitoring system.`);
        startScreamMonitor();
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') return Alert.alert("Deny", "Microphone permission required");
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: r } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        setRecording(r); setIsRecording(true);
        triggerSOS("LIVE_AUDIO_STARTED");
      }
    } catch (e) { Alert.alert("Hardware Error", "Mic access failed."); }
  };

  const toggleVideoRecording = async () => {
    try {
      if (isVideoRecording) {
        if (cameraRef.current) {
          await cameraRef.current.stopRecording();
        }
      } else {
        const { status } = await requestPermission();
        if (status !== 'granted') return Alert.alert("Deny", "Camera permission required");
        
        const { status: micStatus } = await Audio.requestPermissionsAsync();
        if (micStatus !== 'granted') return Alert.alert("Deny", "Microphone permission required for video");

        setIsVideoRecording(true);
        triggerSOS("LIVE_VIDEO_STARTED");
        
        // Wait 800ms for React to physically render the <CameraView> 
        // to the screen and assign the cameraRef before starting recording
        setTimeout(() => {
          if (cameraRef.current) {
            cameraRef.current.recordAsync({
              maxDuration: 60, // Limit to 60s for tactical efficiency
              quality: '720p',
            }).then((video: any) => {
               // Wait until the file is written to disk before unmounting the camera component!
               setIsVideoRecording(false);

               // Prompt the user before uploading the video evidence
               Alert.alert(
                 "Upload Evidence?",
                 "Do you want to send this video footage to the command center?",
                 [
                   { text: "Discard", style: "cancel", onPress: () => console.log("Video discarded by user.") },
                   { text: "Send Video", onPress: () => {
                      uploadEvidence(video.uri, 'video/mp4');
                      triggerSOS("VIDEO_EVIDENCE_STORED");
                      Alert.alert("Video Secured", "Tactical footage transmitted to dashboard.");
                   }}
                 ]
               );
            }).catch((err: any) => {
               setIsVideoRecording(false);
               Alert.alert("Camera Error", "Failed to finalize video capture.");
            });
          } else {
            setIsVideoRecording(false);
            Alert.alert("Error", "Camera failed to load.");
          }
        }, 800);
      }
    } catch (e) { 
      Alert.alert("Camera Error", "Failed to start capture sequence.");
      setIsVideoRecording(false);
    }
  };

  const uploadEvidence = async (uri: string, type: string) => {
    try {
      const formData = new FormData();
      const ext = type.split('/')[1];

      // @ts-ignore
      formData.append('audio', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        name: `evidence-${Date.now()}.${ext}`,
        type,
      });
      formData.append('userId', nameRef.current);

      await axios.post(`http://${ipRef.current}:5000/upload-audio`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Accept': 'application/json',
        },
        timeout: 120000 // High timeout for video
      });
      console.log(`${type.split('/')[0].toUpperCase()} Uplink Successful`);
    } catch (e) {
      console.error("Uplink Failed", e);
    }
  };

  const handleSafeHandshake = () => {
    setInputPin("");
    setShowPinPrompt(true);
  };

  const verifyPin = () => {
    setShowPinPrompt(false);
    if (inputPin === "9999") {
       // Silently send duress code without indicating success on phone
       triggerSOS("DURESS_SILENT_TRIGGERED");
    }
    else if (inputPin === userPin) { 
       emergencyActiveRef.current = false;
       emergencyTimeRef.current = "";
       triggerSOS("USER_REPORTED_SAFE"); 
       Alert.alert("Verified Safe", "System marking as safe. Please exit the app now."); 
    }
    else Alert.alert("Access Denied", "Incorrect PIN logged.");
  };

  if (showFakeCall) {
    return (
    <View style={[styles.fakeCallContainer, { backgroundColor: '#1c1c1e' }]}>
        <View style={styles.fakeCallTopGroup}>
          <Text style={styles.fakeCallTitle}>Dad</Text>
          <Text style={styles.fakeCallSub}>is calling...</Text>
        </View>

        <View style={styles.fakeCallBottomGroup}>
          <View style={styles.fakeCallActionsRow}>
            <View style={styles.fakeCallActionItem}>
               <TouchableOpacity style={[styles.fakeCallBtn, { backgroundColor: '#ff3b30' }]} onPress={stopFakeCall}>
                 <MaterialIcons name="call-end" size={36} color="#ffffff" />
               </TouchableOpacity>
               <Text style={styles.fakeCallActionTextBtn}>Decline</Text>
            </View>

            <View style={styles.fakeCallActionItem}>
               <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                 <TouchableOpacity style={[styles.fakeCallBtn, { backgroundColor: '#34c759' }]} onPress={stopFakeCall}>
                   <MaterialIcons name="call" size={36} color="#ffffff" />
                 </TouchableOpacity>
               </Animated.View>
               <Text style={styles.fakeCallActionTextBtn}>Answer</Text>
            </View>
          </View>
        </View>
      </View>
    )
  }

  if (showConfig) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.configContainer}>
        <Text style={styles.title}>⚙️ INITIALIZATION</Text>
        <Text style={styles.subtext}>Configure SafeBand Uplink</Text>

        <View style={styles.inputCard}>
          <Text style={styles.label}>LAPTOP IPv4 ADDRESS</Text>
          <TextInput style={styles.input} placeholder="e.g. 192.168.1.10" placeholderTextColor="#666" value={serverIp} onChangeText={setServerIp} />

          <Text style={styles.label}>CALLSIGN (IDENTITY)</Text>
          <TextInput style={styles.input} placeholder="e.g. Juliet" placeholderTextColor="#666" value={userName} onChangeText={setUserName} />

          <Text style={styles.label}>STAND-DOWN PIN</Text>
          <TextInput style={styles.input} placeholder="e.g. 1234" placeholderTextColor="#666" secureTextEntry keyboardType="numeric" value={userPin} onChangeText={setUserPin} />

          <Text style={styles.label}>EMERGENCY CONTACT 1 (OPTIONAL)</Text>
          <TextInput style={styles.input} placeholder="e.g. +1234567890" placeholderTextColor="#666" keyboardType="phone-pad" value={contact1} onChangeText={setContact1} />

          <Text style={styles.label}>EMERGENCY CONTACT 2 (OPTIONAL)</Text>
          <TextInput style={styles.input} placeholder="e.g. +0987654321" placeholderTextColor="#666" keyboardType="phone-pad" value={contact2} onChangeText={setContact2} />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={saveConfig}>
          <Text style={styles.btnText}>ESTABLISH LINK</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>SafeBand</Text>
            <Text style={styles.headerSubtitle}>Personal Security</Text>
            {isScreamMonitoring && <Text style={{ fontSize: 9, color: '#ec4899', marginTop: 2, fontWeight: '800', letterSpacing: 1 }}>🔊 MIC ACTIVE</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <TouchableOpacity onPress={() => setShowConfig(true)} style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 24 }}>⚙️</Text>
            </TouchableOpacity>
            <Text style={[styles.statusLine, { color: isConnected ? '#10b981' : '#f43f5e' }]}>
              {isConnected ? '● SECURE LINK' : '○ DISCONNECTED'}
            </Text>
          </View>
        </View>

        <View style={styles.mapContainer}>
          {isVideoRecording ? (
            <CameraView style={{ flex: 1 }} ref={cameraRef} mode="video" facing="back" mute={false} />
          ) : location ? (
            <MapView style={{ flex: 1 }} initialRegion={{ ...location, latitudeDelta: 0.005, longitudeDelta: 0.005 }}>
              <Marker coordinate={location} title={nameRef.current} description={`📍 ${currentAddress}`} />
            </MapView>
          ) : (
            <View style={styles.mapLoader}><Text style={{ color: '#ec4899', fontWeight: '800', letterSpacing: 1 }}>LOCATING...</Text></View>
          )}
          {isVideoRecording && (
             <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(244, 63, 94, 0.8)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 }}>
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 10 }}>REC 📹</Text>
             </View>
          )}
        </View>

        <View style={styles.actionGrid}>
          <TouchableOpacity 
            style={styles.primarySOS} 
            onPress={() => Alert.alert("Hold to Activate", "Please press and HOLD the SOS button for 0.5s to trigger the emergency uplink.")}
            onLongPress={async () => {
              Vibration.vibrate(500); // 0.5s haptic
              
              if (emergencyActiveRef.current) {
                 Alert.alert("Emergency Active", `Signal already dispatched safely at ${emergencyTimeRef.current}. Live tracking continuous.`);
                 if (!showFakeCallRef.current) startFakeCall();
                 return;
              }
              
              emergencyActiveRef.current = true;
              emergencyTimeRef.current = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

              await triggerSOS("BUTTON_SOS");
              startFakeCall();
            }} 
            delayLongPress={500}
          >
            <View style={styles.sosInner}>
              <Text style={styles.sosText}>SOS</Text>
              <Text style={styles.sosSub}>HOLD 0.5s</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 4-Button Horizontal Action Bar */}
        <View style={styles.horizontalActionBar}>
          <TouchableOpacity style={[styles.actionBtnH, isRecording && styles.recordingBtn]} onPress={toggleRecording} disabled={isVideoRecording}>
            <Text style={styles.actionIconH}>{isRecording ? "⏹️" : "🎙️"}</Text>
            <Text style={styles.btnTextH}>{isRecording ? "STOP" : "AUDIO"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionBtnH, isVideoRecording && styles.recordingBtn]} onPress={toggleVideoRecording} disabled={isRecording}>
            <Text style={styles.actionIconH}>{isVideoRecording ? "⏹️" : "📹"}</Text>
            <Text style={styles.btnTextH}>{isVideoRecording ? "STOP" : "VIDEO"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtnH} onPress={startFakeCall}>
            <Text style={styles.actionIconH}>📱</Text>
            <Text style={styles.btnTextH}>CALL</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtnH} onPress={() => setShowHelplines(true)}>
            <Text style={styles.actionIconH}>📞</Text>
            <Text style={styles.btnTextH}>DIRECTORY</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.safeBtnContainer}>
          <TouchableOpacity style={styles.safeBtn} onPress={handleSafeHandshake}>
            <Text style={styles.safeBtnText}>🛡️ I Am Safe Now</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.footerInfo}>Scream / Shake to instantly trigger SOS</Text>

      </ScrollView>

      <Modal visible={showHelplines} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Emergency Directory</Text>
              <TouchableOpacity onPress={() => setShowHelplines(false)}><Text style={{ fontSize: 28, color: '#94a3b8', fontWeight: '300' }}>✕</Text></TouchableOpacity>
            </View>
            <FlatList data={HELPLINES} keyExtractor={i => i.id} renderItem={({ item }) => (
              <TouchableOpacity style={styles.listItem} onPress={() => Linking.openURL(`tel:${item.num}`)}>
                <Text style={{ fontSize: 28 }}>{item.icon}</Text>
                <View style={{ marginLeft: 15 }}>
                  <Text style={styles.listTitle}>{item.title}</Text>
                  <Text style={styles.listNum}>{item.num}</Text>
                </View>
              </TouchableOpacity>
            )} />
          </View>
        </View>
      </Modal>
      <Modal visible={showPinPrompt} animationType="fade" transparent={true}>
        <View style={styles.modalOverlayC}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.pinCard}>
            <Text style={{ fontSize: 22, fontWeight: '900', color: '#db2777', marginBottom: 10 }}>Safety Verification</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, textAlign: 'center' }}>Enter PIN to stand down. Warning: Wrong PIN alerts authorities.</Text>
            
            <TextInput 
              style={styles.pinInput} 
              placeholder="****" 
              placeholderTextColor="#9ca3af"
              secureTextEntry 
              keyboardType="numeric" 
              value={inputPin} 
              onChangeText={setInputPin}
              autoFocus 
            />
            
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 }}>
              <TouchableOpacity style={[styles.pinBtn, { backgroundColor: '#f3f4f6' }]} onPress={() => setShowPinPrompt(false)}>
                <Text style={{ color: '#4b5563', fontWeight: 'bold' }}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pinBtn, { backgroundColor: '#db2777' }]} onPress={verifyPin}>
                <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>VERIFY</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  // Fake Call - Dark iOS Style
  fakeCallContainer: { flex: 1, backgroundColor: '#1c1c1e', alignItems: 'center', paddingTop: height * 0.15, justifyContent: 'space-between' },
  fakeCallTopGroup: { alignItems: 'center' },
  fakeCallTitle: { color: '#ffffff', fontSize: 42, fontWeight: '300', letterSpacing: 0.5 },
  fakeCallSub: { color: '#ffffff', fontSize: 16, marginTop: 4, opacity: 0.6 },
  fakeCallBottomGroup: { width: '100%', alignItems: 'center', paddingBottom: height * 0.1 },
  fakeCallActionsRow: { flexDirection: 'row', justifyContent: 'space-around', width: '80%', marginTop: 30 },
  fakeCallActionItem: { alignItems: 'center' },
  fakeCallBtn: { width: 75, height: 75, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },
  fakeCallActionText: { color: '#ffffff', fontSize: 16, marginTop: 12, fontWeight: '400', opacity: 0.7 },
  fakeCallActionTextBtn: { color: '#ffffff', fontSize: 16, marginTop: 12, fontWeight: '400' },

  // Config Container
  configContainer: { flex: 1, backgroundColor: '#fffdf9', padding: 30, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '900', color: '#db2777', marginBottom: 8, letterSpacing: 1 }, 
  subtext: { color: '#6b7280', marginBottom: 40, fontSize: 14, fontWeight: '500', letterSpacing: 0.5 },
  inputCard: { backgroundColor: '#ffffff', padding: 25, borderRadius: 20, marginBottom: 30, shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8, borderWidth: 1, borderColor: '#fbcfe8' },
  label: { color: '#db2777', fontSize: 11, fontWeight: '800', marginBottom: 8, marginTop: 15, letterSpacing: 1.5, textTransform: 'uppercase' },
  input: { borderBottomWidth: 1, borderColor: '#fbcfe8', color: '#1f2937', paddingVertical: 12, fontSize: 16, fontWeight: '500' },
  saveBtn: { backgroundColor: '#fde047', padding: 20, borderRadius: 16, alignItems: 'center', shadowColor: '#fef08a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.8, shadowRadius: 15, elevation: 8 },
  btnText: { color: '#1f2937', fontWeight: '800', letterSpacing: 1.2, fontSize: 15 },

  // Main Container
  container: { flex: 1, backgroundColor: '#fffdf9' },
  scrollContent: { padding: 24, alignItems: 'center', paddingTop: 60 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 30 },
  headerTitle: { fontSize: 34, fontWeight: '900', color: '#db2777', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 11, color: '#f472b6', fontWeight: '800', letterSpacing: 2.5, marginTop: 4 },
  iconBtn: { padding: 12, backgroundColor: '#ffffff', borderRadius: 40, marginBottom: 8, borderWidth: 1, borderColor: '#fbcfe8', shadowColor: '#fbcfe8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
  statusLine: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Map
  mapContainer: { width: '100%', height: height * 0.28, borderRadius: 24, overflow: 'hidden', borderWidth: 3, borderColor: '#fbcfe8', marginBottom: 30, shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 },
  mapLoader: { flex: 1, backgroundColor: '#fdf2f8', justifyContent: 'center', alignItems: 'center' },

  // Action Grid
  actionGrid: { alignItems: 'center', marginBottom: 25 },
  
  // Primary SOS Button (Pastel Pink/Red Mix)
  primarySOS: { width: 180, height: 180, borderRadius: 90, backgroundColor: '#fbcfe8', padding: 8, elevation: 20, shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.8, shadowRadius: 25 },
  sosInner: { flex: 1, borderRadius: 86, backgroundColor: '#fb7185', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#fda4af' },
  sosText: { color: '#ffffff', fontSize: 52, fontWeight: '900', letterSpacing: 2, textShadowColor: 'rgba(0,0,0,0.1)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  sosSub: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '800', marginTop: 4, letterSpacing: 1 },

  // Horizontal Action Bar (4 Buttons)
  horizontalActionBar: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 5 },
  actionBtnH: { flex: 1, backgroundColor: '#ffffff', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginHorizontal: 4, paddingVertical: 12, borderWidth: 1, borderColor: '#fbcfe8', shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  recordingBtn: { backgroundColor: '#fef08a', borderColor: '#fde047', borderWidth: 2 },
  actionIconH: { fontSize: 22, marginBottom: 4 },
  btnTextH: { color: '#db2777', fontWeight: '800', fontSize: 8.5, letterSpacing: 0.5, marginTop: 4 },

  // Safe Button (Minimized to prevent accidental tap)
  safeBtnContainer: { width: '100%', alignItems: 'center', marginTop: 15 },
  safeBtn: { backgroundColor: '#fdf2f8', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20, alignItems: 'center', borderColor: '#fbcfe8', borderWidth: 1 },
  safeBtnText: { color: '#db2777', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  footerInfo: { color: '#9ca3af', fontSize: 12, marginTop: 24, fontWeight: '600', letterSpacing: 0.5 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.85)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fffdf9', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 30, minHeight: '65%', shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20, borderWidth: 1, borderColor: '#fbcfe8' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  modalTitle: { fontSize: 24, fontWeight: '900', color: '#db2777', letterSpacing: 0.5 },
  listItem: { flexDirection: 'row', alignItems: 'center', padding: 22, backgroundColor: '#ffffff', marginBottom: 16, borderRadius: 20, borderWidth: 1, borderColor: '#fbcfe8', shadowColor: '#f9a8d4', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  listTitle: { fontWeight: '800', color: '#374151', fontSize: 17, marginBottom: 4 },
  listNum: { color: '#f472b6', fontSize: 15, fontWeight: '700', letterSpacing: 1 },

  // PIN Prompt custom modal
  modalOverlayC: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center' },
  pinCard: { width: '85%', backgroundColor: '#ffffff', borderRadius: 24, padding: 25, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 15 },
  pinInput: { width: '80%', height: 60, backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 2, borderColor: '#fbcfe8', textAlign: 'center', fontSize: 24, fontWeight: 'bold', color: '#db2777', letterSpacing: 8 },
  pinBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginHorizontal: 5 }
});