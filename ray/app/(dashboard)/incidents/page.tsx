import DashboardIncidents from "@/components/DashboardIncidents";
export default function IncidentsPage() {
  return <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6"><h1 className="font-jersey text-3xl sm:text-4xl text-white mb-6">Incidents</h1><DashboardIncidents expanded /></main>;
}
