export function getToday() {
    return new Date().toISOString().slice(0, 10);
}

export function getYesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().slice(0, 10);
}
