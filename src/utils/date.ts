export function humanizedDateTime() {
  const now = new Date(Date.now());
  const dt = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
  for (const key in dt) {
    dt[key as keyof typeof dt] = dt[key as keyof typeof dt].toString().padStart(2, '0') as any;
  }
  return `${dt.year}-${dt.month}-${dt.day}@${dt.hour}h${dt.minute}m${dt.second}s`;
}

export function getMessageTimeStamp() {
  const date = Date.now();
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const d = new Date(date);
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = ('0' + d.getMinutes()).slice(-2);
  let meridiem = 'am';
  if (hours >= 12) {
    meridiem = 'pm';
    hours -= 12;
  }
  if (hours === 0) {
    hours = 12;
  }
  const formattedDate = month + ' ' + day + ', ' + year + ' ' + hours + ':' + minutes + meridiem;
  return formattedDate;
}
