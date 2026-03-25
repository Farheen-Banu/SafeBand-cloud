import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';

export const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
        console.error("Background Location Error:", error);
        return;
    }
    if (data) {
        const { locations } = data as any;
        if (locations && locations.length > 0) {
            const location = locations[0];
            try {
                const ip = await AsyncStorage.getItem('BACKEND_IP');
                const userId = await AsyncStorage.getItem('USER_ID') || "User_Alpha";

                if (ip && userId) {
                    const BACKEND_URL = `http://${ip}:5000/location`;
                    
                    let batteryLevel = 100;
                    try {
                        const level = await Battery.getBatteryLevelAsync();
                        batteryLevel = Math.round(level * 100);
                    } catch (e) { /* fallback to 100 if battery module fails */ }

                    await axios.post(BACKEND_URL, {
                        userId: userId,
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        battery: batteryLevel, 
                        triggerType: "ROUTINE"
                    });
                    console.log(`[Background] Location sent: ${location.coords.latitude}, ${location.coords.longitude}`);
                }
            } catch (err) {
                // Silently fail to prevent red LogBox screens during spotty network coverage
                console.log("[Background] Failed to send location uplink. Retrying next cycle.");
            }
        }
    }
});
