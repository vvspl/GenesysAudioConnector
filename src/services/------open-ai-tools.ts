
import axios from 'axios';


// Define the Airport interface
interface Airport {
  iata: string;
  name: string;
}


// Tool function signature matching the JSON schema
export function lookupAirport(args: { city: string }): { status: 'ok' | 'error'; airports: Airport[] } {
  // Internal list of top 10 Saudia destinations
  const airports: (Airport & { city: string })[] = [
    { city: 'Dubai',    iata: 'DXB', name: 'Dubai International Airport' },
    { city: 'London',   iata: 'LHR', name: 'London Heathrow Airport' },
    { city: 'Paris',    iata: 'CDG', name: 'Charles de Gaulle Airport' },
    { city: 'Cairo',    iata: 'CAI', name: 'Cairo International Airport' },
    { city: 'Jeddah',   iata: 'JED', name: 'King Abdulaziz Intl Airport' },
    { city: 'Riyadh',   iata: 'RUH', name: 'King Khalid Intl Airport' },
    { city: 'Karachi',  iata: 'KHI', name: 'Jinnah Intl Airport' },
    { city: 'Mumbai',   iata: 'BOM', name: 'Chhatrapati Shivaji Intl Airport' },
    { city: 'New York', iata: 'JFK', name: 'John F. Kennedy Intl Airport' },
    { city: 'Istanbul', iata: 'IST', name: 'Istanbul Airport' },
  ];

    // Normalize input for case-insensitive comparison
    const query = args.city.trim().toLowerCase();

    // Find matching airports
    const matches = airports.filter(a => a.city.toLowerCase() === query);

    // Return results or an error status
    if (matches.length > 0) {
        // Strip out the `city` field to match the Airport interface
        const result: Airport[] = matches.map(({ iata, name }) => ({ iata, name }));
        return { status: 'ok', airports: result };
    } else {
        return { status: 'error', airports: [] };
    }
}


// Define interfaces matching the tool schema
interface Pax {
  adults: number;
  children: number;
  infants: number;
}
interface Itinerary {
  flightNo: string; // Flight number
  origin: string; // IATA code for departure airport
  destination: string; // IATA code for arrival airport
  departDate: string; // YYYY-MM-DD
  departTime: string; // HH:mm
  arriveTime: string; // HH:mm
  cabin: string; // Cabin class
  ancillaries?: string[]; // Optional ancillaries
  pax: Pax; // Passenger counts  
  summary: string;
  price: number;
  currency: string;
}

interface SearchFlightsArgs {
  origin: string;       // IATA code for departure airport
  destination: string;  // IATA code for arrival airport
  depart: string;       // YYYY-MM-DD outbound date
  pax: Pax;             // Passenger counts
  cabin: string;        // Cabin class,
  ancillaries?: string[]; // Optional ancillaries
}

interface SearchFlightResult {
  status: 'ok' | 'error';
  itinerary: Itinerary;
}


interface CreateItineraryArgs {
  itineraries: Itinerary[];
  phoneNumber:string
}

interface CreateItineraryResult {
  status: 'ok' | 'error';
  pnr?: string
}


/**
 * searchFlights
 * Simulates searching Saudia itineraries for given parameters.
 */
export function searchFlight(
  args: SearchFlightsArgs
): SearchFlightResult {
  const { origin, destination, depart,  pax, cabin,ancillaries } = args;

  
  console.log(`Generating itinerary for ${origin} to ${destination} on ${depart} for ${JSON.stringify(pax)} in ${cabin} class`);
  
  const departTime= generateRandomDepartTime();
  const arrivalTime= generateRandomArrivalTime(departTime);
  const flightNumber= `SV${randomNumeric(3)}`;
  const baseFare= Math.floor(Math.random() * 1000) + 1000; // Random fare between 1000 and 2000 SAR
  const totalFare = baseFare * pax.adults + (baseFare * 0.5 * pax.children) + (baseFare * 0.1 * pax.infants); // Assuming children pay half and infants pay 10% of the adult fare


  const summary = `${flightNumber} ${depart} ${origin} ${departTime} → ${destination} ${arrivalTime} — ${cabin.charAt(0).toUpperCase() + cabin.slice(1)} — ${JSON.stringify(ancillaries)} — ${totalFare.toLocaleString()} SAR`;

  return {
    status: 'ok',
    itinerary :{
      flightNo: flightNumber,
      origin: origin,
      destination: destination,
      departDate: depart,
      departTime: departTime,
      arriveTime: arrivalTime,
      cabin: cabin,
      ancillaries: ancillaries || [],
      pax: pax,
      summary:summary,
      price: totalFare,
      currency: 'SAR'
    }
  };
}




/**
 * Generates a random alphanumeric string of the given length.
 */
function randomAlphaNum(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function padNumberWithZeros(num: number, length: number): string {
  let numString = num.toString();

  if (numString.length >= length) {
    return numString;
  } else {
    const zerosToAdd = length - numString.length;
    return "0".repeat(zerosToAdd) + numString;
  }
}

function generateRandomDepartTime(): string {
  const mins=[
    '00',
    '15',
    '30',
    '45'
  ]
  const hours = padNumberWithZeros(Math.floor(Math.random() * 24),2); // Random hour between 0 and 23
  const minutes = mins[Math.floor(Math.random() * mins.length)];
  return `${hours}:${minutes}`;
  
}
function generateRandomArrivalTime(departTime:string): string {
  const departHour = parseInt(departTime.split(':')[0], 10);
  const flightTime= Math.floor(Math.random() * 3) + 1; // Random flight time between 1 and 3 hours
  

  return `${padNumberWithZeros((departHour + flightTime)%24,2)}:${departTime.split(':')[1]}`; // Add 2 hours to depart time
}  


/**
 * Generates a random numeric string of the given length.
 */
function randomNumeric(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

/**
 * Dummy createItinerary function.
 * - Generates a 6-char alphanumeric PNR and Sends a WhatsApp link with the itinerary details.
 * - Returns the PNR in the result.
 */
export async function createItinerary(
  args: CreateItineraryArgs
): Promise<CreateItineraryResult> {
  const { itineraries,phoneNumber} = args;

  // Basic validation

  /*
  let data = JSON.stringify({
    "ActionName": "CreatePNR",
    "ActionData": args
  });
console.log(`[CreateItineraryTool]Creating PNR with data: ${data}`);
let config = {
  method: 'post',
  url: process.env.CREATE_PNR_ENDPOINT,
  headers: { 
    'Content-Type': 'application/json'
  },
  data : data
};


const response=await axios.request(config);
console.log(`[CreateItineraryTool]Response from PNR Status:${response.status}| ${JSON.stringify(response.data)}`);
if(response.status !== 200){
  return {
    status: 'error',
    pnr: undefined
  };
} else {
  return {
    status: 'ok',
    pnr: response.data.pnr
  }
}
  */
 return {
  status: 'ok',
  pnr: randomAlphaNum(6) // Generate a random 6-character alphanumeric
 }

}