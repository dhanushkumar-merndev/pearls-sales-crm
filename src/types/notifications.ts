export type HospitalNotification = {
  id: string;
  title: string;
  description: string;
  href: string;
  count: number;
  tone: "default" | "warning" | "critical";
  read: boolean;
};

export type NotificationResponse = {
  items: HospitalNotification[];
  unreadCount: number;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
